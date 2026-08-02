drop function if exists match_policy_chunks(halfvec, int, uuid);

create or replace function match_policy_chunks(
  query_embedding halfvec(3072),
  match_count int,
  filter_company uuid
)
returns table (
  id uuid,
  policy_id uuid,
  document_id uuid,
  chunk_text text,
  similarity float
)
language sql stable as $$
  select
    policy_chunks.id,
    policy_chunks.policy_id,
    policy_chunks.document_id,
    policy_chunks.chunk_text,
    1 - (policy_chunks.embedding <=> query_embedding) as similarity
  from policy_chunks
  where policy_chunks.company_id = filter_company
  order by policy_chunks.embedding <=> query_embedding
  limit match_count;
$$;

drop function if exists match_policy_chunks_hybrid(halfvec, text, int, uuid);

create or replace function match_policy_chunks_hybrid(
  query_embedding halfvec(3072),
  query_text text,
  match_count int,
  filter_company uuid
)
returns table (
  id uuid,
  policy_id uuid,
  document_id uuid,
  chunk_text text,
  similarity float,
  hybrid_score float
)
language sql stable as $$
  with vector_hits as (
    select
      policy_chunks.id,
      policy_chunks.policy_id,
      policy_chunks.document_id,
      policy_chunks.chunk_text,
      1 - (policy_chunks.embedding <=> query_embedding) as similarity,
      row_number() over (order by policy_chunks.embedding <=> query_embedding) as v_rank
    from policy_chunks
    where policy_chunks.company_id = filter_company
    order by policy_chunks.embedding <=> query_embedding
    limit match_count * 2
  ),
  text_hits as (
    select
      policy_chunks.id,
      row_number() over (
        order by ts_rank(to_tsvector('english', policy_chunks.chunk_text), plainto_tsquery('english', query_text)) desc
      ) as t_rank
    from policy_chunks
    where policy_chunks.company_id = filter_company
      and to_tsvector('english', policy_chunks.chunk_text) @@ plainto_tsquery('english', query_text)
    limit match_count * 2
  ),
  fused_ids as (
    select id from vector_hits
    union
    select id from text_hits
  )
  select
    c.id,
    c.policy_id,
    c.document_id,
    c.chunk_text,
    coalesce(v.similarity, 0) as similarity,
    coalesce(1.0 / (60 + v.v_rank), 0)::float + coalesce(1.0 / (60 + t.t_rank), 0)::float as hybrid_score
  from fused_ids f
  join policy_chunks c on c.id = f.id
  left join vector_hits v on v.id = f.id
  left join text_hits t on t.id = f.id
  order by hybrid_score desc
  limit match_count;
$$;

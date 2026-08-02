# Trio Infra RAG Golden Dataset Draft

Organization resolved from slug `trio-infra`: `8dde7580-2fed-4040-9d7d-c9e9fd83c859`.

## Evaluation Philosophy

Real employees will ask Genie lazily. The raw user question is the test input and must be sent exactly as written, including casing, spelling mistakes, abbreviations, incomplete phrasing, Indian workplace wording, and vague follow-ups. Query rewriting may later normalize intent, but the golden dataset must preserve raw phrasing so the system is measured on employee understanding rather than polished prompt writing.

Metrics should be read separately: raw-query retrieval success, rewritten-query retrieval success when a rewrite-enabled server is supplied to the harness, and final answer correctness.

Source documents used:

- `POSH_Policy_TRIO.pdf`
- `Code_of_Conduct_Trio.docx`
- `Holiday List.pdf`
- `Trio_Leave & Attendance_Policy.pdf`

Dataset size: 93 questions (81 answerable, 12 unanswerable).

## trio-posh-001

- Query style: POLICY_LANGUAGE
- Question: Who does the POSH policy apply to?
- Policy/document: `POSH_Policy_TRIO.pdf`
- Expected section: 2. SCOPE & APPLICABILITY
- Expected fact: The POSH policy applies to all employees of Trio Infrastructure Private Limited, including permanent, probationary, temporary, part-time, trainees, interns, consultants, and contractors.
- Exact supporting source excerpt:

> This policy applies to all employees of TRIO INFRASTRUCTURE PRIVATE LIMITED, including permanent, probationary, temporary, part-time, trainees, interns, consultants, and contractors.

## trio-posh-001-lazy-1

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-posh-001
- Question: posh applies to whom
- Policy/document: `POSH_Policy_TRIO.pdf`
- Expected section: 2. SCOPE & APPLICABILITY
- Expected fact: The POSH policy applies to all employees of Trio Infrastructure Private Limited, including permanent, probationary, temporary, part-time, trainees, interns, consultants, and contractors.
- Exact supporting source excerpt:

> This policy applies to all employees of TRIO INFRASTRUCTURE PRIVATE LIMITED, including permanent, probationary, temporary, part-time, trainees, interns, consultants, and contractors.

## trio-posh-001-lazy-2

- Query style: LAZY_EMPLOYEE
- Scoring note: This lazy query is scored only against the minimum facts needed for this exact wording, not the full canonical answer.
- Canonical fact id: trio-posh-001
- Question: contractor posh me apply?
- Policy/document: `POSH_Policy_TRIO.pdf`
- Expected section: 2. SCOPE & APPLICABILITY
- Expected fact: Contractors are covered by the POSH policy.
- Exact supporting source excerpt:

> This policy applies to all employees of TRIO INFRASTRUCTURE PRIVATE LIMITED, including permanent, probationary, temporary, part-time, trainees, interns, consultants, and contractors.

## trio-posh-002

- Query style: POLICY_LANGUAGE
- Question: How soon should I file a sexual harassment complaint?
- Policy/document: `POSH_Policy_TRIO.pdf`
- Expected section: 8. REDRESSAL OF COMPLAINTS OF SEXUAL HARASSMENT
- Expected fact: An aggrieved individual should file a written complaint within 90 days from the date of the last alleged incident.
- Exact supporting source excerpt:

> Any aggrieved individual may file a complaint of sexual harassment in writing within 90 days from the date of the last alleged incident.

## trio-posh-002-lazy-1

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-posh-002
- Question: posh complaint 90 days?
- Policy/document: `POSH_Policy_TRIO.pdf`
- Expected section: 8. REDRESSAL OF COMPLAINTS OF SEXUAL HARASSMENT
- Expected fact: An aggrieved individual should file a written complaint within 90 days from the date of the last alleged incident.
- Exact supporting source excerpt:

> Any aggrieved individual may file a complaint of sexual harassment in writing within 90 days from the date of the last alleged incident.

## trio-posh-002-lazy-2

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-posh-002
- Question: harassment complaint kab tak
- Policy/document: `POSH_Policy_TRIO.pdf`
- Expected section: 8. REDRESSAL OF COMPLAINTS OF SEXUAL HARASSMENT
- Expected fact: An aggrieved individual should file a written complaint within 90 days from the date of the last alleged incident.
- Exact supporting source excerpt:

> Any aggrieved individual may file a complaint of sexual harassment in writing within 90 days from the date of the last alleged incident.

## trio-posh-003

- Query style: POLICY_LANGUAGE
- Question: Can I send a POSH complaint directly to the external IC member?
- Policy/document: `POSH_Policy_TRIO.pdf`
- Expected section: 5. RESPONSE TO POSSIBLE INCIDENTS OF SEXUAL HARASSMENT
- Expected fact: If the aggrieved individual does not wish to file with the IC, they can send the complaint directly to the external IC member Kavita at thewayforward@kavitarathod.com.
- Exact supporting source excerpt:

> If the aggrieved individual does not wish to file the complaint with IC for some reason, they can send the complaint directly to the external member of the IC to Kavita at thewayforward@kavitarathod.com

## trio-posh-003-lazy-1

- Query style: LAZY_EMPLOYEE
- Scoring note: This lazy query is scored only against the minimum facts needed for this exact wording, not the full canonical answer.
- Canonical fact id: trio-posh-003
- Question: posh complaint where
- Policy/document: `POSH_Policy_TRIO.pdf`
- Expected section: 5. RESPONSE TO POSSIBLE INCIDENTS OF SEXUAL HARASSMENT
- Expected fact: A POSH complaint may be sent to any IC member, or directly to external IC member Kavita at the listed email if the complainant does not wish to file with the IC.
- Exact supporting source excerpt:

> If the aggrieved individual does not wish to file the complaint with IC for some reason, they can send the complaint directly to the external member of the IC to Kavita at thewayforward@kavitarathod.com

## trio-posh-003-lazy-2

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-posh-003
- Question: ic nahi jana can mail kavita?
- Policy/document: `POSH_Policy_TRIO.pdf`
- Expected section: 5. RESPONSE TO POSSIBLE INCIDENTS OF SEXUAL HARASSMENT
- Expected fact: If the aggrieved individual does not wish to file with the IC, they can send the complaint directly to the external IC member Kavita at thewayforward@kavitarathod.com.
- Exact supporting source excerpt:

> If the aggrieved individual does not wish to file the complaint with IC for some reason, they can send the complaint directly to the external member of the IC to Kavita at thewayforward@kavitarathod.com

## trio-posh-004

- Query style: POLICY_LANGUAGE
- Question: What interim relief can the IC recommend during a POSH inquiry?
- Policy/document: `POSH_Policy_TRIO.pdf`
- Expected section: 8. REDRESSAL OF COMPLAINTS OF SEXUAL HARASSMENT / A. Complaint Handling Process
- Expected fact: At the complainant's written request, the IC may recommend transfer to another team or workplace, restriction on respondent reporting on complainant performance, paid leave up to 3 months in addition to entitled leave, or other relief to ensure a fair inquiry process.
- Exact supporting source excerpt:

> At the written request of the complainant, the IC may recommend interim measures to HR, including: Transfer of the complainant to another team or workplace; Restriction on the respondent from reporting on the complainant’s performance; Grant of paid leave (up to 3 months in addition to entitled leave); Any other relief to ensure a fair inquiry process

## trio-posh-004-lazy-1

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-posh-004
- Question: posh interim relief kya milega
- Policy/document: `POSH_Policy_TRIO.pdf`
- Expected section: 8. REDRESSAL OF COMPLAINTS OF SEXUAL HARASSMENT / A. Complaint Handling Process
- Expected fact: At the complainant's written request, the IC may recommend transfer to another team or workplace, restriction on respondent reporting on complainant performance, paid leave up to 3 months in addition to entitled leave, or other relief to ensure a fair inquiry process.
- Exact supporting source excerpt:

> At the written request of the complainant, the IC may recommend interim measures to HR, including: Transfer of the complainant to another team or workplace; Restriction on the respondent from reporting on the complainant’s performance; Grant of paid leave (up to 3 months in addition to entitled leave); Any other relief to ensure a fair inquiry process

## trio-posh-004-lazy-2

- Query style: LAZY_EMPLOYEE
- Scoring note: This lazy query is scored only against the minimum facts needed for this exact wording, not the full canonical answer.
- Canonical fact id: trio-posh-004
- Question: can i get leave during posh inquiry
- Policy/document: `POSH_Policy_TRIO.pdf`
- Expected section: 8. REDRESSAL OF COMPLAINTS OF SEXUAL HARASSMENT / A. Complaint Handling Process
- Expected fact: Yes. At the complainant's written request, the IC may recommend paid leave up to 3 months during the POSH inquiry.
- Exact supporting source excerpt:

> At the written request of the complainant, the IC may recommend interim measures to HR, including: Transfer of the complainant to another team or workplace; Restriction on the respondent from reporting on the complainant’s performance; Grant of paid leave (up to 3 months in addition to entitled leave); Any other relief to ensure a fair inquiry process

## trio-posh-005

- Query style: POLICY_LANGUAGE
- Question: How long does the IC have to complete a POSH inquiry?
- Policy/document: `POSH_Policy_TRIO.pdf`
- Expected section: 8. REDRESSAL OF COMPLAINTS OF SEXUAL HARASSMENT / A. Complaint Handling Process
- Expected fact: The policy states the IC must complete the inquiry within 90 working days from receipt of the complaint.
- Exact supporting source excerpt:

> The IC must complete the inquiry within 90 working days from the receipt of complaint.

## trio-posh-005-lazy-1

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-posh-005
- Question: ic inquiry how many days
- Policy/document: `POSH_Policy_TRIO.pdf`
- Expected section: 8. REDRESSAL OF COMPLAINTS OF SEXUAL HARASSMENT / A. Complaint Handling Process
- Expected fact: The policy states the IC must complete the inquiry within 90 working days from receipt of the complaint.
- Exact supporting source excerpt:

> The IC must complete the inquiry within 90 working days from the receipt of complaint.

## trio-posh-005-lazy-2

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-posh-005
- Question: posh investigation timeline?
- Policy/document: `POSH_Policy_TRIO.pdf`
- Expected section: 8. REDRESSAL OF COMPLAINTS OF SEXUAL HARASSMENT / A. Complaint Handling Process
- Expected fact: The policy states the IC must complete the inquiry within 90 working days from receipt of the complaint.
- Exact supporting source excerpt:

> The IC must complete the inquiry within 90 working days from the receipt of complaint.

## trio-posh-005-followup-1

- Query style: FOLLOW_UP
- Canonical fact id: trio-posh-005
- Question: and appeal kab tak?
- Follow-up history:
  - user: How long does the IC have to complete a POSH inquiry?
  - assistant: The IC must complete the inquiry within 90 working days.
- Policy/document: `POSH_Policy_TRIO.pdf`
- Expected section: 8. REDRESSAL OF COMPLAINTS OF SEXUAL HARASSMENT
- Expected fact: The complainant and respondent both have the right to appeal the decision within 90 days, as per Section 18 of the POSH Act.
- Exact supporting source excerpt:

> The complainant and the respondent both have the right to appeal the decision within 90 days, as per Section 18 of the POSH Act.

## trio-posh-006

- Query style: POLICY_LANGUAGE
- Question: Who is the Presiding Officer of the SH-IC?
- Policy/document: `POSH_Policy_TRIO.pdf`
- Expected section: 9. APPENDIX-2 MEMBERS OF SH-IC
- Expected fact: Latasha Gupta, Front Desk Executive, is listed as Presiding Officer (Chairperson) of the SH-IC.
- Exact supporting source excerpt:

> Latasha Gupta Front Desk Exe. Presiding Officer (Chairperson) latashalaksh9724@gmail.com +91 9321912170

## trio-posh-006-lazy-1

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-posh-006
- Question: sh ic chairperson who
- Policy/document: `POSH_Policy_TRIO.pdf`
- Expected section: 9. APPENDIX-2 MEMBERS OF SH-IC
- Expected fact: Latasha Gupta, Front Desk Executive, is listed as Presiding Officer (Chairperson) of the SH-IC.
- Exact supporting source excerpt:

> Latasha Gupta Front Desk Exe. Presiding Officer (Chairperson) latashalaksh9724@gmail.com +91 9321912170

## trio-posh-006-lazy-2

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-posh-006
- Question: latasha role in posh?
- Policy/document: `POSH_Policy_TRIO.pdf`
- Expected section: 9. APPENDIX-2 MEMBERS OF SH-IC
- Expected fact: Latasha Gupta, Front Desk Executive, is listed as Presiding Officer (Chairperson) of the SH-IC.
- Exact supporting source excerpt:

> Latasha Gupta Front Desk Exe. Presiding Officer (Chairperson) latashalaksh9724@gmail.com +91 9321912170

## trio-posh-007

- Query style: POLICY_LANGUAGE
- Question: Is lack of evidence enough to make a POSH complaint malicious?
- Policy/document: `POSH_Policy_TRIO.pdf`
- Expected section: 5. RESPONSE TO POSSIBLE INCIDENTS OF SEXUAL HARASSMENT / False or Malicious Complaints
- Expected fact: No. The policy states that lack of evidence alone does not make a complaint false or malicious.
- Exact supporting source excerpt:

> However, lack of evidence alone does not make a complaint false or malicious.

## trio-posh-007-lazy-1

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-posh-007
- Question: no proof means false complaint?
- Policy/document: `POSH_Policy_TRIO.pdf`
- Expected section: 5. RESPONSE TO POSSIBLE INCIDENTS OF SEXUAL HARASSMENT / False or Malicious Complaints
- Expected fact: No. The policy states that lack of evidence alone does not make a complaint false or malicious.
- Exact supporting source excerpt:

> However, lack of evidence alone does not make a complaint false or malicious.

## trio-posh-007-lazy-2

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-posh-007
- Question: evidence nahi hai malicious?
- Policy/document: `POSH_Policy_TRIO.pdf`
- Expected section: 5. RESPONSE TO POSSIBLE INCIDENTS OF SEXUAL HARASSMENT / False or Malicious Complaints
- Expected fact: No. The policy states that lack of evidence alone does not make a complaint false or malicious.
- Exact supporting source excerpt:

> However, lack of evidence alone does not make a complaint false or malicious.

## trio-conduct-001

- Query style: POLICY_LANGUAGE
- Question: Does the Code of Conduct apply to interns and contractors?
- Policy/document: `Code_of_Conduct_Trio.docx`
- Expected section: 1. Purpose & Scope
- Expected fact: The Code applies to every employee, contractor, consultant, and associate, and specifically to full-time employees, part-time staff, interns, and third-party representatives acting on behalf of the Company.
- Exact supporting source excerpt:

> This Code sets out the standards of behaviour and professional ethics expected of every employee, contractor, consultant, and associate of Trio Infrastructure Private Limited. This Code applies to all full-time employees, part-time staff, interns, and third-party representatives acting on behalf of the Company

## trio-conduct-001-lazy-1

- Query style: LAZY_EMPLOYEE
- Scoring note: This lazy query is scored only against the minimum facts needed for this exact wording, not the full canonical answer.
- Canonical fact id: trio-conduct-001
- Question: code applies interns?
- Policy/document: `Code_of_Conduct_Trio.docx`
- Expected section: 1. Purpose & Scope
- Expected fact: Yes. Interns are covered by the Code of Conduct.
- Exact supporting source excerpt:

> This Code sets out the standards of behaviour and professional ethics expected of every employee, contractor, consultant, and associate of Trio Infrastructure Private Limited. This Code applies to all full-time employees, part-time staff, interns, and third-party representatives acting on behalf of the Company

## trio-conduct-001-lazy-2

- Query style: LAZY_EMPLOYEE
- Scoring note: This lazy query is scored only against the minimum facts needed for this exact wording, not the full canonical answer.
- Canonical fact id: trio-conduct-001
- Question: contractor also code of conduct?
- Policy/document: `Code_of_Conduct_Trio.docx`
- Expected section: 1. Purpose & Scope
- Expected fact: Yes. Contractors are covered by the Code of Conduct.
- Exact supporting source excerpt:

> This Code sets out the standards of behaviour and professional ethics expected of every employee, contractor, consultant, and associate of Trio Infrastructure Private Limited. This Code applies to all full-time employees, part-time staff, interns, and third-party representatives acting on behalf of the Company

## trio-conduct-002

- Query style: POLICY_LANGUAGE
- Question: What is the limit for nominal gifts from clients or vendors?
- Policy/document: `Code_of_Conduct_Trio.docx`
- Expected section: 5. Conflict of Interest
- Expected fact: Nominal gifts of token value under ₹500 in line with cultural norms are generally acceptable.
- Exact supporting source excerpt:

> Do not accept gifts, favours, or hospitality from clients or vendors that could influence business decisions. Nominal gifts of token value (under ₹500) in line with cultural norms are generally acceptable.

## trio-conduct-002-lazy-1

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-conduct-002
- Question: gift limit?
- Policy/document: `Code_of_Conduct_Trio.docx`
- Expected section: 5. Conflict of Interest
- Expected fact: Nominal gifts of token value under ₹500 in line with cultural norms are generally acceptable.
- Exact supporting source excerpt:

> Do not accept gifts, favours, or hospitality from clients or vendors that could influence business decisions. Nominal gifts of token value (under ₹500) in line with cultural norms are generally acceptable.

## trio-conduct-002-lazy-2

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-conduct-002
- Question: vendor gift 500 ok?
- Policy/document: `Code_of_Conduct_Trio.docx`
- Expected section: 5. Conflict of Interest
- Expected fact: Nominal gifts of token value under ₹500 in line with cultural norms are generally acceptable.
- Exact supporting source excerpt:

> Do not accept gifts, favours, or hospitality from clients or vendors that could influence business decisions. Nominal gifts of token value (under ₹500) in line with cultural norms are generally acceptable.

## trio-conduct-003

- Query style: POLICY_LANGUAGE
- Question: Who should I tell if I have a conflict of interest?
- Policy/document: `Code_of_Conduct_Trio.docx`
- Expected section: 5. Conflict of Interest
- Expected fact: Employees must disclose personal, financial, or family relationships that may influence professional decisions to HR or their Reporting Manager.
- Exact supporting source excerpt:

> Disclose to HR or your Reporting Manager any personal, financial, or family relationship that may influence — or be perceived to influence — your professional decisions.

## trio-conduct-003-lazy-1

- Query style: LAZY_EMPLOYEE
- Scoring note: This lazy query is scored only against the minimum facts needed for this exact wording, not the full canonical answer.
- Canonical fact id: trio-conduct-003
- Question: conflict tell whom
- Policy/document: `Code_of_Conduct_Trio.docx`
- Expected section: 5. Conflict of Interest
- Expected fact: Conflicts should be disclosed to HR or the Reporting Manager.
- Exact supporting source excerpt:

> Disclose to HR or your Reporting Manager any personal, financial, or family relationship that may influence — or be perceived to influence — your professional decisions.

## trio-conduct-003-lazy-2

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-conduct-003
- Question: family relation disclose to who
- Policy/document: `Code_of_Conduct_Trio.docx`
- Expected section: 5. Conflict of Interest
- Expected fact: Employees must disclose personal, financial, or family relationships that may influence professional decisions to HR or their Reporting Manager.
- Exact supporting source excerpt:

> Disclose to HR or your Reporting Manager any personal, financial, or family relationship that may influence — or be perceived to influence — your professional decisions.

## trio-conduct-004

- Query style: POLICY_LANGUAGE
- Question: Who can approve a public statement or media communication on behalf of the company?
- Policy/document: `Code_of_Conduct_Trio.docx`
- Expected section: 8. Social Media & External Communication
- Expected fact: Media enquiries, press releases, or public statements on behalf of the Company must be approved by the Director before publication.
- Exact supporting source excerpt:

> Any media enquiries, press releases, or public statements on behalf of the Company must be approved by the Director before publication.

## trio-conduct-004-lazy-1

- Query style: LAZY_EMPLOYEE
- Scoring note: This lazy query is scored only against the minimum facts needed for this exact wording, not the full canonical answer.
- Canonical fact id: trio-conduct-004
- Question: press statement approval
- Policy/document: `Code_of_Conduct_Trio.docx`
- Expected section: 8. Social Media & External Communication
- Expected fact: Press statements or public communications on behalf of the company require Director approval.
- Exact supporting source excerpt:

> Any media enquiries, press releases, or public statements on behalf of the Company must be approved by the Director before publication.

## trio-conduct-004-lazy-2

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-conduct-004
- Question: media query director approval?
- Policy/document: `Code_of_Conduct_Trio.docx`
- Expected section: 8. Social Media & External Communication
- Expected fact: Media enquiries, press releases, or public statements on behalf of the Company must be approved by the Director before publication.
- Exact supporting source excerpt:

> Any media enquiries, press releases, or public statements on behalf of the Company must be approved by the Director before publication.

## trio-conduct-005

- Query style: POLICY_LANGUAGE
- Question: If I see a safety issue at a project site, who do I report it to?
- Policy/document: `Code_of_Conduct_Trio.docx`
- Expected section: 7. Health, Safety & Environment
- Expected fact: Unsafe conditions, near-misses, accidents, or injuries must be reported to the site supervisor or HR immediately.
- Exact supporting source excerpt:

> Report any unsafe conditions, near-misses, accidents, or injuries to the site supervisor or HR immediately.

## trio-conduct-005-lazy-1

- Query style: LAZY_EMPLOYEE
- Scoring note: This lazy query is scored only against the minimum facts needed for this exact wording, not the full canonical answer.
- Canonical fact id: trio-conduct-005
- Question: site accident report whom
- Policy/document: `Code_of_Conduct_Trio.docx`
- Expected section: 7. Health, Safety & Environment
- Expected fact: Site accidents or unsafe conditions must be reported to the site supervisor or HR.
- Exact supporting source excerpt:

> Report any unsafe conditions, near-misses, accidents, or injuries to the site supervisor or HR immediately.

## trio-conduct-005-lazy-2

- Query style: LAZY_EMPLOYEE
- Scoring note: This lazy query is scored only against the minimum facts needed for this exact wording, not the full canonical answer.
- Canonical fact id: trio-conduct-005
- Question: unsafe condition bolna kisko
- Policy/document: `Code_of_Conduct_Trio.docx`
- Expected section: 7. Health, Safety & Environment
- Expected fact: Unsafe conditions must be reported to the site supervisor or HR.
- Exact supporting source excerpt:

> Report any unsafe conditions, near-misses, accidents, or injuries to the site supervisor or HR immediately.

## trio-conduct-006

- Query style: POLICY_LANGUAGE
- Question: What disciplinary actions can happen for Code of Conduct violations?
- Policy/document: `Code_of_Conduct_Trio.docx`
- Expected section: 11. Disciplinary Action
- Expected fact: Disciplinary measures may include verbal or written warning, suspension with or without pay pending investigation, forfeiture of benefits/incentives/accrued entitlements, termination for serious or repeated violations, or legal action for criminal conduct or significant financial loss.
- Exact supporting source excerpt:

> Disciplinary measures may include: Verbal or written warning. Suspension with or without pay pending investigation. Forfeiture of benefits, incentives, or accrued entitlements. Termination of employment for serious or repeated violations. Legal action where violations involve criminal conduct or significant financial loss to the Company.

## trio-conduct-006-lazy-1

- Query style: LAZY_EMPLOYEE
- Scoring note: This lazy query is scored only against the minimum facts needed for this exact wording, not the full canonical answer.
- Canonical fact id: trio-conduct-006
- Question: conduct violation punishment
- Policy/document: `Code_of_Conduct_Trio.docx`
- Expected section: 11. Disciplinary Action
- Expected fact: Code violations can attract disciplinary action depending on severity, such as warning, suspension, termination, forfeiture, or legal action.
- Exact supporting source excerpt:

> Disciplinary measures may include: Verbal or written warning. Suspension with or without pay pending investigation. Forfeiture of benefits, incentives, or accrued entitlements. Termination of employment for serious or repeated violations. Legal action where violations involve criminal conduct or significant financial loss to the Company.

## trio-conduct-006-lazy-2

- Query style: LAZY_EMPLOYEE
- Scoring note: This lazy query is scored only against the minimum facts needed for this exact wording, not the full canonical answer.
- Canonical fact id: trio-conduct-006
- Question: code break what action
- Policy/document: `Code_of_Conduct_Trio.docx`
- Expected section: 11. Disciplinary Action
- Expected fact: Breaking the Code can lead to disciplinary action, including warning, suspension, termination, forfeiture, or legal action depending on severity.
- Exact supporting source excerpt:

> Disciplinary measures may include: Verbal or written warning. Suspension with or without pay pending investigation. Forfeiture of benefits, incentives, or accrued entitlements. Termination of employment for serious or repeated violations. Legal action where violations involve criminal conduct or significant financial loss to the Company.

## trio-conduct-007

- Query style: POLICY_LANGUAGE
- Question: Can I install software on company systems if it helps me work faster?
- Policy/document: `Code_of_Conduct_Trio.docx`
- Expected section: 6. Use of Company Assets & Technology
- Expected fact: Unauthorised installation of software, sharing login credentials, or access to restricted systems is prohibited.
- Exact supporting source excerpt:

> Unauthorised installation of software, sharing of login credentials, or access to restricted systems is prohibited.

## trio-conduct-007-lazy-1

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-conduct-007
- Question: can install software laptop
- Policy/document: `Code_of_Conduct_Trio.docx`
- Expected section: 6. Use of Company Assets & Technology
- Expected fact: Unauthorised installation of software, sharing login credentials, or access to restricted systems is prohibited.
- Exact supporting source excerpt:

> Unauthorised installation of software, sharing of login credentials, or access to restricted systems is prohibited.

## trio-conduct-007-lazy-2

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-conduct-007
- Question: software install allowed?
- Policy/document: `Code_of_Conduct_Trio.docx`
- Expected section: 6. Use of Company Assets & Technology
- Expected fact: Unauthorised installation of software, sharing login credentials, or access to restricted systems is prohibited.
- Exact supporting source excerpt:

> Unauthorised installation of software, sharing of login credentials, or access to restricted systems is prohibited.

## trio-holiday-001

- Query style: POLICY_LANGUAGE
- Question: How many holidays are listed for 2026?
- Policy/document: `Holiday List.pdf`
- Expected section: HOLIDAY LIST | YEAR 2026
- Expected fact: The 2026 holiday list contains 10 holidays.
- Exact supporting source excerpt:

> Sr.No Occasion / Festival Date Day Month 1 Republic Day 26-Jan-26 Monday January ... 10 Christmas 25-Dec-26 Friday December

## trio-holiday-001-lazy-1

- Query style: LAZY_EMPLOYEE
- Scoring note: This lazy query is scored only against the minimum facts needed for this exact wording, not the full canonical answer.
- Canonical fact id: trio-holiday-001
- Question: holiday list
- Policy/document: `Holiday List.pdf`
- Expected section: HOLIDAY LIST | YEAR 2026
- Expected fact: Return the actual 2026 holiday list: Republic Day — 26-Jan-26; Holi — 03-Mar-26; Maharashtra Day — 01-May-26; Independence Day — 15-Aug-26; Ganesh Chaturthi — 14-Sep-26; Mahatma Gandhi Jayanti — 02-Oct-26; Dussehra — 20-Oct-26; Diwali-Govardhan Puja — 09-Nov-26; Diwali-Balipratipada/Bhai Dooj — 10-Nov-26; Christmas — 25-Dec-26.
- Exact supporting source excerpt:

> Sr.No Occasion / Festival Date Day Month 1 Republic Day 26-Jan-26 Monday January ... 10 Christmas 25-Dec-26 Friday December

## trio-holiday-001-lazy-2

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-holiday-001
- Question: how many holiday 2026
- Policy/document: `Holiday List.pdf`
- Expected section: HOLIDAY LIST | YEAR 2026
- Expected fact: The 2026 holiday list contains 10 holidays.
- Exact supporting source excerpt:

> Sr.No Occasion / Festival Date Day Month 1 Republic Day 26-Jan-26 Monday January ... 10 Christmas 25-Dec-26 Friday December

## trio-holiday-002

- Query style: POLICY_LANGUAGE
- Question: What date is Ganesh Chaturthi holiday in 2026?
- Policy/document: `Holiday List.pdf`
- Expected section: HOLIDAY LIST | YEAR 2026
- Expected fact: Ganesh Chaturthi is listed on 14-Sep-26, Monday, in September.
- Exact supporting source excerpt:

> 5 Ganesh Chaturthi 14-Sep-26 Monday September

## trio-holiday-002-lazy-1

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-holiday-002
- Question: ganesh chaturthi off when
- Policy/document: `Holiday List.pdf`
- Expected section: HOLIDAY LIST | YEAR 2026
- Expected fact: Ganesh Chaturthi is listed on 14-Sep-26, Monday, in September.
- Exact supporting source excerpt:

> 5 Ganesh Chaturthi 14-Sep-26 Monday September

## trio-holiday-002-lazy-2

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-holiday-002
- Question: ganpati holiday date
- Policy/document: `Holiday List.pdf`
- Expected section: HOLIDAY LIST | YEAR 2026
- Expected fact: Ganesh Chaturthi is listed on 14-Sep-26, Monday, in September.
- Exact supporting source excerpt:

> 5 Ganesh Chaturthi 14-Sep-26 Monday September

## trio-holiday-003

- Query style: POLICY_LANGUAGE
- Question: Are site-based employees always off on public holidays?
- Policy/document: `Holiday List.pdf`
- Expected section: HOLIDAY LIST | YEAR 2026
- Expected fact: No. Site-based roles may be required to work on public holidays based on project and operational requirements, and in such cases employees are eligible for Comp-Off as per policy.
- Exact supporting source excerpt:

> Site-based roles may be required to work on public holidays based on project and operational requirements. In such cases, employees will be eligible for Compensatory Off (Comp-Off) as per policy.

## trio-holiday-003-lazy-1

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-holiday-003
- Question: site public holiday work?
- Policy/document: `Holiday List.pdf`
- Expected section: HOLIDAY LIST | YEAR 2026
- Expected fact: No. Site-based roles may be required to work on public holidays based on project and operational requirements, and in such cases employees are eligible for Comp-Off as per policy.
- Exact supporting source excerpt:

> Site-based roles may be required to work on public holidays based on project and operational requirements. In such cases, employees will be eligible for Compensatory Off (Comp-Off) as per policy.

## trio-holiday-003-lazy-2

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-holiday-003
- Question: public holiday site employee comp off?
- Policy/document: `Holiday List.pdf`
- Expected section: HOLIDAY LIST | YEAR 2026
- Expected fact: No. Site-based roles may be required to work on public holidays based on project and operational requirements, and in such cases employees are eligible for Comp-Off as per policy.
- Exact supporting source excerpt:

> Site-based roles may be required to work on public holidays based on project and operational requirements. In such cases, employees will be eligible for Compensatory Off (Comp-Off) as per policy.

## trio-holiday-004

- Query style: POLICY_LANGUAGE
- Question: Which Diwali holidays are listed in 2026?
- Policy/document: `Holiday List.pdf`
- Expected section: HOLIDAY LIST | YEAR 2026
- Expected fact: Diwali-Govardhan Puja is listed on 09-Nov-26, Monday, and Diwali-Balipratipada/Bhai Dooj is listed on 10-Nov-26, Tuesday.
- Exact supporting source excerpt:

> 8 Diwali-Govardhan Puja 09-Nov-26 Monday November 9 Diwali-Balipratipada/Bhai Dooj 10-Nov-26 Tuesday November

## trio-holiday-004-lazy-1

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-holiday-004
- Question: diwali off when
- Policy/document: `Holiday List.pdf`
- Expected section: HOLIDAY LIST | YEAR 2026
- Expected fact: Diwali-Govardhan Puja is listed on 09-Nov-26, Monday, and Diwali-Balipratipada/Bhai Dooj is listed on 10-Nov-26, Tuesday.
- Exact supporting source excerpt:

> 8 Diwali-Govardhan Puja 09-Nov-26 Monday November 9 Diwali-Balipratipada/Bhai Dooj 10-Nov-26 Tuesday November

## trio-holiday-004-lazy-2

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-holiday-004
- Question: diwali holidays 2026 dates
- Policy/document: `Holiday List.pdf`
- Expected section: HOLIDAY LIST | YEAR 2026
- Expected fact: Diwali-Govardhan Puja is listed on 09-Nov-26, Monday, and Diwali-Balipratipada/Bhai Dooj is listed on 10-Nov-26, Tuesday.
- Exact supporting source excerpt:

> 8 Diwali-Govardhan Puja 09-Nov-26 Monday November 9 Diwali-Balipratipada/Bhai Dooj 10-Nov-26 Tuesday November

## trio-holiday-004-followup-1

- Query style: FOLLOW_UP
- Canonical fact id: trio-holiday-004
- Question: and site people if they work?
- Follow-up history:
  - user: Which Diwali holidays are listed in 2026?
  - assistant: Diwali-Govardhan Puja is on 09-Nov-26 and Diwali-Balipratipada/Bhai Dooj is on 10-Nov-26.
- Policy/document: `Holiday List.pdf`
- Expected section: HOLIDAY LIST | YEAR 2026
- Expected fact: Site-based roles may be required to work on public holidays based on project and operational requirements, and in such cases employees are eligible for Comp-Off as per policy.
- Exact supporting source excerpt:

> Site-based roles may be required to work on public holidays based on project and operational requirements. In such cases, employees will be eligible for Compensatory Off (Comp-Off) as per policy.

## trio-leave-001

- Query style: POLICY_LANGUAGE
- Question: How much annual leave do confirmed employees get?
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 4.1 Annual Leave (AL)
- Expected fact: Confirmed employees are entitled to 18 working days of Annual Leave per year.
- Exact supporting source excerpt:

> All confirmed employees are entitled to 18 (Eighteen) days of Annual Leave per year, which may be availed for any purpose.

## trio-leave-001-lazy-1

- Query style: LAZY_EMPLOYEE
- Scoring note: This lazy query is scored only against the minimum facts needed for this exact wording, not the full canonical answer.
- Canonical fact id: trio-leave-001
- Question: how many leaves
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 4.1 Annual Leave (AL)
- Expected fact: Employees get 18 working days of Annual Leave per year.
- Exact supporting source excerpt:

> All confirmed employees are entitled to 18 (Eighteen) days of Annual Leave per year, which may be availed for any purpose.

## trio-leave-001-lazy-2

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-leave-001
- Question: annual leave kitna
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 4.1 Annual Leave (AL)
- Expected fact: Confirmed employees are entitled to 18 working days of Annual Leave per year.
- Exact supporting source excerpt:

> All confirmed employees are entitled to 18 (Eighteen) days of Annual Leave per year, which may be availed for any purpose.

## trio-leave-001-followup-1

- Query style: FOLLOW_UP
- Canonical fact id: trio-leave-001
- Question: what about probation?
- Follow-up history:
  - user: How much annual leave do confirmed employees get?
  - assistant: Confirmed employees get 18 working days of Annual Leave per year.
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 4.1 Annual Leave (AL)
- Expected fact: Leave is not permitted during probation, but leave entitlement continues to accrue and is credited upon confirmation.
- Exact supporting source excerpt:

> Leave is not permitted during the probation period. However, leave entitlement will continue to accrue and will be credited upon confirmation.

## trio-leave-002

- Query style: POLICY_LANGUAGE
- Question: Do I get leave during probation?
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 4.1 Annual Leave (AL)
- Expected fact: Leave is not permitted during probation, but leave entitlement continues to accrue and is credited upon confirmation.
- Exact supporting source excerpt:

> Leave is not permitted during the probation period. However, leave entitlement will continue to accrue and will be credited upon confirmation.

## trio-leave-002-lazy-1

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-leave-002
- Question: probation leave allowed?
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 4.1 Annual Leave (AL)
- Expected fact: Leave is not permitted during probation, but leave entitlement continues to accrue and is credited upon confirmation.
- Exact supporting source excerpt:

> Leave is not permitted during the probation period. However, leave entitlement will continue to accrue and will be credited upon confirmation.

## trio-leave-002-lazy-2

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-leave-002
- Question: new joiner can take leave?
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 4.1 Annual Leave (AL)
- Expected fact: Leave is not permitted during probation, but leave entitlement continues to accrue and is credited upon confirmation.
- Exact supporting source excerpt:

> Leave is not permitted during the probation period. However, leave entitlement will continue to accrue and will be credited upon confirmation.

## trio-leave-003

- Query style: POLICY_LANGUAGE
- Question: How many annual leave days can I carry forward after 31 March?
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 4.1 Annual Leave (AL)
- Expected fact: Employees may carry forward a maximum of 5 unutilised Annual Leave days to the next year; any balance above 5 lapses automatically on 31 March.
- Exact supporting source excerpt:

> At the end of each year, employees may carry forward a maximum of 5 (five) unutilised Annual Leave days to the subsequent year. Any balance in excess of 5 days shall lapse automatically on 31st March.

## trio-leave-003-lazy-1

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-leave-003
- Question: al carry forward max
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 4.1 Annual Leave (AL)
- Expected fact: Employees may carry forward a maximum of 5 unutilised Annual Leave days to the next year; any balance above 5 lapses automatically on 31 March.
- Exact supporting source excerpt:

> At the end of each year, employees may carry forward a maximum of 5 (five) unutilised Annual Leave days to the subsequent year. Any balance in excess of 5 days shall lapse automatically on 31st March.

## trio-leave-003-lazy-2

- Query style: LAZY_EMPLOYEE
- Scoring note: This lazy query is scored only against the minimum facts needed for this exact wording, not the full canonical answer.
- Canonical fact id: trio-leave-003
- Question: 5 leaves carry forward?
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 4.1 Annual Leave (AL)
- Expected fact: Yes. Up to 5 Annual Leave days can be carried forward.
- Exact supporting source excerpt:

> At the end of each year, employees may carry forward a maximum of 5 (five) unutilised Annual Leave days to the subsequent year. Any balance in excess of 5 days shall lapse automatically on 31st March.

## trio-leave-004

- Query style: POLICY_LANGUAGE
- Question: If a weekly off or fixed holiday falls between my annual leave dates, is it counted as annual leave?
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 4.1 Annual Leave (AL)
- Expected fact: No. Leave is counted on the working day principle, and an intermediate Weekly Off or Fixed Holiday sandwiched between AL dates will not be treated as AL.
- Exact supporting source excerpt:

> Leave will be counted on working day principle. In case a Weekly Off or Fixed Holiday gets sandwiched between AL dates, the intermediate days will not be treated as AL.

## trio-leave-004-lazy-1

- Query style: LAZY_EMPLOYEE
- Scoring note: This lazy query is scored only against the minimum facts needed for this exact wording, not the full canonical answer.
- Canonical fact id: trio-leave-004
- Question: holiday between leave counted?
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 4.1 Annual Leave (AL)
- Expected fact: A fixed holiday between Annual Leave dates is not counted as Annual Leave.
- Exact supporting source excerpt:

> Leave will be counted on working day principle. In case a Weekly Off or Fixed Holiday gets sandwiched between AL dates, the intermediate days will not be treated as AL.

## trio-leave-004-lazy-2

- Query style: LAZY_EMPLOYEE
- Scoring note: This lazy query is scored only against the minimum facts needed for this exact wording, not the full canonical answer.
- Canonical fact id: trio-leave-004
- Question: weekly off sandwich al count?
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 4.1 Annual Leave (AL)
- Expected fact: A weekly off sandwiched between AL dates is not counted as AL.
- Exact supporting source excerpt:

> Leave will be counted on working day principle. In case a Weekly Off or Fixed Holiday gets sandwiched between AL dates, the intermediate days will not be treated as AL.

## trio-leave-005

- Query style: POLICY_LANGUAGE
- Question: How much maternity leave is available for the first two surviving children?
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 4.4 Maternity Leave
- Expected fact: Eligible female employees are entitled to 26 weeks of paid maternity leave for the first two surviving children.
- Exact supporting source excerpt:

> 26 (twenty-six) weeks of paid maternity leave for the first two surviving children.

## trio-leave-005-lazy-1

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-leave-005
- Question: maternity leave weeks
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 4.4 Maternity Leave
- Expected fact: Eligible female employees are entitled to 26 weeks of paid maternity leave for the first two surviving children.
- Exact supporting source excerpt:

> 26 (twenty-six) weeks of paid maternity leave for the first two surviving children.

## trio-leave-005-lazy-2

- Query style: LAZY_EMPLOYEE
- Scoring note: This lazy query is scored only against the minimum facts needed for this exact wording, not the full canonical answer.
- Canonical fact id: trio-leave-005
- Question: first baby maternity kitna
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 4.4 Maternity Leave
- Expected fact: For the first child, eligible employees get 26 weeks of paid maternity leave.
- Exact supporting source excerpt:

> 26 (twenty-six) weeks of paid maternity leave for the first two surviving children.

## trio-leave-006

- Query style: POLICY_LANGUAGE
- Question: What is the eligibility requirement for maternity leave?
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 4.4 Maternity Leave
- Expected fact: Eligibility requires at least 80 days of actual service with the Company in the 12 months immediately preceding the expected delivery date.
- Exact supporting source excerpt:

> Eligibility requires a minimum of 80 (eighty) days of actual service with the Company in the 12 months immediately preceding the expected date of delivery.

## trio-leave-006-lazy-1

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-leave-006
- Question: maternity eligibility
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 4.4 Maternity Leave
- Expected fact: Eligibility requires at least 80 days of actual service with the Company in the 12 months immediately preceding the expected delivery date.
- Exact supporting source excerpt:

> Eligibility requires a minimum of 80 (eighty) days of actual service with the Company in the 12 months immediately preceding the expected date of delivery.

## trio-leave-006-lazy-2

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-leave-006
- Question: 80 days maternity rule?
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 4.4 Maternity Leave
- Expected fact: Eligibility requires at least 80 days of actual service with the Company in the 12 months immediately preceding the expected delivery date.
- Exact supporting source excerpt:

> Eligibility requires a minimum of 80 (eighty) days of actual service with the Company in the 12 months immediately preceding the expected date of delivery.

## trio-leave-007

- Query style: POLICY_LANGUAGE
- Question: How many late arrivals or missed punch-ins become one day of annual leave?
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 5.2 Working Hours, Late Arrivals & Missed Punch-Ins
- Expected fact: Three instances of missed punch-ins or three instances of late arrivals beyond the flexibility period, or a combination totaling three in a month, count as one day of Annual Leave; without leave balance, the day is treated as LOP.
- Exact supporting source excerpt:

> 3 (three) instances of missed punch-ins OR 3 (three) instances of late arrivals (beyond the flexibility period) in any given month shall collectively be counted as 1 (one) day of Annual Leave. Accumulation of 3 late arrivals or 3 missed punch-ins (or a combination totalling 3) within a month shall result in a deduction of 1 (one) Annual Leave Day from the employee's balance. In the absence of any leave balance, the day shall be treated as LOP.

## trio-leave-007-lazy-1

- Query style: LAZY_EMPLOYEE
- Scoring note: This lazy query is scored only against the minimum facts needed for this exact wording, not the full canonical answer.
- Canonical fact id: trio-leave-007
- Question: late 3 times?
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 5.2 Working Hours, Late Arrivals & Missed Punch-Ins
- Expected fact: Three late arrivals in a month count as one day of Annual Leave; if no leave balance is available, it is treated as LOP.
- Exact supporting source excerpt:

> 3 (three) instances of missed punch-ins OR 3 (three) instances of late arrivals (beyond the flexibility period) in any given month shall collectively be counted as 1 (one) day of Annual Leave. Accumulation of 3 late arrivals or 3 missed punch-ins (or a combination totalling 3) within a month shall result in a deduction of 1 (one) Annual Leave Day from the employee's balance. In the absence of any leave balance, the day shall be treated as LOP.

## trio-leave-007-lazy-2

- Query style: LAZY_EMPLOYEE
- Scoring note: This lazy query is scored only against the minimum facts needed for this exact wording, not the full canonical answer.
- Canonical fact id: trio-leave-007
- Question: 3 missed punch lop?
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 5.2 Working Hours, Late Arrivals & Missed Punch-Ins
- Expected fact: Three missed punch-ins in a month count as one day of Annual Leave; if no leave balance is available, it is treated as LOP.
- Exact supporting source excerpt:

> 3 (three) instances of missed punch-ins OR 3 (three) instances of late arrivals (beyond the flexibility period) in any given month shall collectively be counted as 1 (one) day of Annual Leave. Accumulation of 3 late arrivals or 3 missed punch-ins (or a combination totalling 3) within a month shall result in a deduction of 1 (one) Annual Leave Day from the employee's balance. In the absence of any leave balance, the day shall be treated as LOP.

## trio-leave-008

- Query style: POLICY_LANGUAGE
- Question: Can I take annual leave during my notice period?
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 7. Leave During Notice Period
- Expected fact: During notice period, Annual Leave or Comp-Off is subject to prior approval of the Reporting Manager and HR; leave without explicit approval extends the notice period by equivalent days unless waived by Management.
- Exact supporting source excerpt:

> During the notice period (whether tendered by the employee or initiated by the Company), availing of Annual Leave or Comp-Off — is subject to the prior approval of the Reporting Manager and HR. Any leave availed during the notice period without explicit approval shall result in a proportionate extension of the notice period by an equivalent number of days, unless expressly waived by Management.

## trio-leave-008-lazy-1

- Query style: LAZY_EMPLOYEE
- Scoring note: This lazy query is scored only against the minimum facts needed for this exact wording, not the full canonical answer.
- Canonical fact id: trio-leave-008
- Question: can i take al notice period
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 7. Leave During Notice Period
- Expected fact: Annual Leave during notice period requires prior approval from the Reporting Manager and HR.
- Exact supporting source excerpt:

> During the notice period (whether tendered by the employee or initiated by the Company), availing of Annual Leave or Comp-Off — is subject to the prior approval of the Reporting Manager and HR. Any leave availed during the notice period without explicit approval shall result in a proportionate extension of the notice period by an equivalent number of days, unless expressly waived by Management.

## trio-leave-008-lazy-2

- Query style: LAZY_EMPLOYEE
- Scoring note: This lazy query is scored only against the minimum facts needed for this exact wording, not the full canonical answer.
- Canonical fact id: trio-leave-008
- Question: notice period leave approval?
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 7. Leave During Notice Period
- Expected fact: Leave during notice period requires prior approval from the Reporting Manager and HR.
- Exact supporting source excerpt:

> During the notice period (whether tendered by the employee or initiated by the Company), availing of Annual Leave or Comp-Off — is subject to the prior approval of the Reporting Manager and HR. Any leave availed during the notice period without explicit approval shall result in a proportionate extension of the notice period by an equivalent number of days, unless expressly waived by Management.

## trio-unanswerable-001

- Query style: UNANSWERABLE
- Question: What is Trio infra's work from home policy for employees?
- Policy/document: N/A
- Expected section: N/A
- Expected fact: Information not present in the four Trio infra policies reviewed.
- Exact supporting source excerpt:

> No supporting excerpt. This is intentionally unanswerable from the reviewed Trio infra source policies.

## trio-unanswerable-001-lazy-1

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-unanswerable-001
- Question: wfh policy
- Policy/document: N/A
- Expected section: N/A
- Expected fact: Information not present in the four Trio infra policies reviewed.
- Exact supporting source excerpt:

> No supporting excerpt. This is intentionally unanswerable from the reviewed Trio infra source policies.

## trio-unanswerable-001-lazy-2

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-unanswerable-001
- Question: remote work allowed?
- Policy/document: N/A
- Expected section: N/A
- Expected fact: Information not present in the four Trio infra policies reviewed.
- Exact supporting source excerpt:

> No supporting excerpt. This is intentionally unanswerable from the reviewed Trio infra source policies.

## trio-unanswerable-002

- Query style: UNANSWERABLE
- Question: How much internet reimbursement can I claim each month?
- Policy/document: N/A
- Expected section: N/A
- Expected fact: Information not present in the four Trio infra policies reviewed.
- Exact supporting source excerpt:

> No supporting excerpt. This is intentionally unanswerable from the reviewed Trio infra source policies.

## trio-unanswerable-002-lazy-1

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-unanswerable-002
- Question: internet reimbursement
- Policy/document: N/A
- Expected section: N/A
- Expected fact: Information not present in the four Trio infra policies reviewed.
- Exact supporting source excerpt:

> No supporting excerpt. This is intentionally unanswerable from the reviewed Trio infra source policies.

## trio-unanswerable-002-lazy-2

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-unanswerable-002
- Question: wifi bill claim kitna
- Policy/document: N/A
- Expected section: N/A
- Expected fact: Information not present in the four Trio infra policies reviewed.
- Exact supporting source excerpt:

> No supporting excerpt. This is intentionally unanswerable from the reviewed Trio infra source policies.

## trio-unanswerable-003

- Query style: UNANSWERABLE
- Question: How many sick leave days do employees get?
- Policy/document: N/A
- Expected section: N/A
- Expected fact: Information not present in the four Trio infra policies reviewed.
- Exact supporting source excerpt:

> No supporting excerpt. This is intentionally unanswerable from the reviewed Trio infra source policies.

## trio-unanswerable-003-lazy-1

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-unanswerable-003
- Question: sick leave kitna
- Policy/document: N/A
- Expected section: N/A
- Expected fact: Information not present in the four Trio infra policies reviewed.
- Exact supporting source excerpt:

> No supporting excerpt. This is intentionally unanswerable from the reviewed Trio infra source policies.

## trio-unanswerable-003-lazy-2

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-unanswerable-003
- Question: how many sl
- Policy/document: N/A
- Expected section: N/A
- Expected fact: Information not present in the four Trio infra policies reviewed.
- Exact supporting source excerpt:

> No supporting excerpt. This is intentionally unanswerable from the reviewed Trio infra source policies.

## trio-unanswerable-004

- Query style: UNANSWERABLE
- Question: What is the official travel allowance for site visits?
- Policy/document: N/A
- Expected section: N/A
- Expected fact: Information not present in the four Trio infra policies reviewed.
- Exact supporting source excerpt:

> No supporting excerpt. This is intentionally unanswerable from the reviewed Trio infra source policies.

## trio-unanswerable-004-lazy-1

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-unanswerable-004
- Question: site travel allowance
- Policy/document: N/A
- Expected section: N/A
- Expected fact: Information not present in the four Trio infra policies reviewed.
- Exact supporting source excerpt:

> No supporting excerpt. This is intentionally unanswerable from the reviewed Trio infra source policies.

## trio-unanswerable-004-lazy-2

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-unanswerable-004
- Question: travel claim for site visit?
- Policy/document: N/A
- Expected section: N/A
- Expected fact: Information not present in the four Trio infra policies reviewed.
- Exact supporting source excerpt:

> No supporting excerpt. This is intentionally unanswerable from the reviewed Trio infra source policies.

## trio-holiday-list-regression-001

- Query style: LAZY_EMPLOYEE
- Canonical fact id: trio-holiday-list-full
- Question: what is in holiday list
- Policy/document: `Holiday List.pdf`
- Expected section: HOLIDAY LIST | YEAR 2026
- Expected fact: Return the actual holidays contained in Holiday List.pdf, not a generic statement and not merely the count.
- Exact supporting source excerpt:

> 1 Republic Day 26-Jan-26 Monday January 2 Holi 03-Mar-26 Tuesday March 3 Maharashtra Day 01-May-26 Friday May 4 Independence Day 15-Aug-26 Saturday August 5 Ganesh Chaturthi 14-Sep-26 Monday September 6 Mahatma Gandhi Jayanti 02-Oct-26 Friday October 7 Dussehra 20-Oct-26 Tuesday October 8 Diwali-Govardhan Puja 09-Nov-26 Monday November 9 Diwali-Balipratipada/Bhai Dooj 10-Nov-26 Tuesday November 10 Christmas 25-Dec-26 Friday December

## trio-leave-annual-leaves-regression-001

- Query style: LAZY_EMPLOYEE
- Scoring note: Regression case for exact observed wording; scored only against annual leave entitlement.
- Canonical fact id: trio-leave-001
- Question: how many Annual leaves
- Policy/document: `Trio_Leave & Attendance_Policy.pdf`
- Expected section: 4.1 Annual Leave (AL)
- Expected fact: Confirmed employees are entitled to 18 working days of Annual Leave per year.
- Exact supporting source excerpt:

> All confirmed employees are entitled to 18 (Eighteen) days of Annual Leave per year, which may be availed for any purpose.

## trio-posh-punishment-typo-regression-001

- Query style: LAZY_EMPLOYEE
- Scoring note: Real-user typo regression; the raw query must be tested exactly as written. This must answer consequence/punishment, not generic POSH prohibition or definitions.
- Canonical fact id: trio-posh-disciplinary-action
- Question: what is teh punishment for POSH
- Policy/document: `POSH_Policy_TRIO.pdf`
- Expected section: 8. REDRESSAL OF COMPLAINTS OF SEXUAL HARASSMENT / B. Disciplinary Actions
- Expected fact: If a POSH complaint is upheld, the IC may recommend disciplinary action depending on severity, including written apology, warning or reprimand, adverse service entry, withholding/cancellation of promotion, withholding increment or bonus, suspension or termination, counselling/behavioral correction, community service, or other corrective action.
- Exact supporting source excerpt:

> If the complaint is upheld after inquiry, the Internal Committee (IC) may recommend disciplinary action against the respondent, which may include one or more of the following measures, depending on the severity of the misconduct: Issuance of a written apology; Formal warning or reprimand; Censure or adverse entry in service records; Withholding or cancellation of promotion; Withholding of salary increment or performance bonus; Suspension or termination of employment; Mandatory attendance in counselling or behavioral correction programs; Assignment of community service or any other corrective action deemed appropriate by the IC.


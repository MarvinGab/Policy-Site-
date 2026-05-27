export const uploadPolicyDocument = async ({ policyId, file, displayName = "", versionLabel = "", effectiveDate = "" }) => {
  if (!policyId) {
    throw new Error("Missing policy ID.");
  }
  if (!file) {
    throw new Error("Missing file.");
  }

  const formData = new FormData();
  formData.append("policyId", policyId);
  formData.append("file", file);
  if (displayName) formData.append("displayName", displayName);
  if (versionLabel) formData.append("versionLabel", versionLabel);
  if (effectiveDate) formData.append("effectiveDate", effectiveDate);

  const response = await fetch("/api/upload", {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Upload failed.");
  }

  return response.json();
};

export const listPolicyDocuments = async ({ policyId }) => {
  if (!policyId) {
    throw new Error("Missing policy ID.");
  }

  const response = await fetch(`/api/policy-documents?policyId=${encodeURIComponent(policyId)}`, {
    credentials: "include",
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to load policy files.");
  }

  const data = await response.json();
  return data || [];
};

export const deletePolicyDocument = async ({ policyId, filePath }) => {
  if (!policyId) {
    throw new Error("Missing policy ID.");
  }
  if (!filePath) {
    throw new Error("Missing file path.");
  }

  const response = await fetch("/api/policy-documents/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ policyId, filePath }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to delete policy file.");
  }

  return response.json();
};

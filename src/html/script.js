const jobNoInput = document.getElementById("jobNo");
const searchButton = document.getElementById("searchButton");
const jobHeaderOutput = document.getElementById("job-header");
const confirmModal = document.getElementById("confirmModal");
const confirmBackdrop = document.getElementById("confirmBackdrop");
const confirmCancelButton = document.getElementById("confirmCancel");
const confirmApproveButton = document.getElementById("confirmApprove");

let currentJobNo = "";
let resolveConfirmation = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[char];
  });
}

function formatValue(key, value) {
  if (value === null || value === undefined || value === "") {
    return "N/A";
  }

  if (/date|on/i.test(key)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString();
    }
  }

  if (typeof value === "number") {
    return value.toLocaleString();
  }

  return String(value);
}

function formatWeight(value) {
  const formatted = formatValue("weight", value);
  return formatted === "N/A" ? formatted : formatted + " KG";
}

function renderMessage(message) {
  jobHeaderOutput.innerHTML =
    '<p class="message">' + escapeHtml(message) + "</p>";
}

function renderIngredients(ingredients) {
  if (!ingredients.length) {
    return (
      '<section class="ingredients">' +
      '<div class="ingredients-header">Ingredients</div>' +
      '<p class="message">No ingredients found for this job.</p>' +
      "</section>"
    );
  }

  const rows = ingredients
    .map(
      (ingredient) =>
        "<tr>" +
        "<td>" +
        escapeHtml(formatValue("IngredientCode", ingredient.IngredientCode)) +
        "</td>" +
        "<td>" +
        escapeHtml(formatValue("IngredientName", ingredient.IngredientName)) +
        "</td>" +
        "<td>" +
        escapeHtml(formatWeight(ingredient.TargetWt)) +
        "</td>" +
        "<td>" +
        escapeHtml(formatValue("ScaleNo", ingredient.ScaleNo)) +
        "</td>" +
        "</tr>",
    )
    .join("");

  return (
    '<section class="ingredients">' +
    '<div class="ingredients-header">Ingredients</div>' +
    '<div class="ingredients-table-wrap">' +
    '<table class="ingredients-table">' +
    "<thead>" +
    "<tr>" +
    "<th>Ingredient Code</th>" +
    "<th>Ingredient Name</th>" +
    "<th>Target Wt</th>" +
    "<th>Scale No</th>" +
    "</tr>" +
    "</thead>" +
    "<tbody>" +
    rows +
    "</tbody>" +
    "</table>" +
    "</div>" +
    "</section>"
  );
}

function closeConfirmModal(confirmed) {
  if (!resolveConfirmation) {
    return;
  }

  confirmModal.hidden = true;
  const resolver = resolveConfirmation;
  resolveConfirmation = null;
  resolver(confirmed);
}

function openConfirmModal() {
  return new Promise((resolve) => {
    resolveConfirmation = resolve;
    confirmModal.hidden = false;
    confirmApproveButton.focus();
  });
}

function renderJobHeader(payload) {
  const { header: jobHeader, ingredients = [] } = payload;
  const isPending =
    String(jobHeader.JobStatus || "").trim().toLowerCase() === "pending";
  const metrics = [
    {
      label: "Job Weight",
      value: formatWeight(jobHeader.ProdWt),
      className: "metric-value-right",
    },
  ]
    .map(
      (metric) =>
        '<div class="metric">' +
        '<p class="metric-label">' +
        escapeHtml(metric.label) +
        "</p>" +
        '<p class="metric-value ' +
        metric.className +
        '">' +
        escapeHtml(metric.value) +
        "</p>" +
        "</div>",
    )
    .join("");

  jobHeaderOutput.innerHTML =
    '<div class="job-header-view">' +
    '<div class="job-header-meta">' +
    '<div class="job-header-title-row">' +
    '<div class="job-header-title-group">' +
    '<h2 class="job-header-title">Job ' +
    escapeHtml(formatValue("JobNo", jobHeader.JobNo)) +
    "</h2>" +
    '<p class="job-header-status">' +
    escapeHtml(formatValue("JobStatus", jobHeader.JobStatus)) +
    "</p>" +
    "</div>" +
    '<button id="scheduleButton" type="button"' +
    (isPending ? "" : " disabled") +
    ">Schedule</button>" +
    "</div>" +
    '<p class="job-header-code">' +
    escapeHtml(formatValue("ProductCode", jobHeader.ProductCode)) +
    "</p>" +
    '<p class="job-header-subtitle">' +
    escapeHtml(formatValue("ProductName", jobHeader.ProductName)) +
    "</p>" +
    "</div>" +
    '<div class="job-header-metrics">' +
    metrics +
    "</div>" +
    renderIngredients(ingredients) +
    "</div>";

  document.getElementById("scheduleButton").addEventListener("click", scheduleJob);
}

function getBackofficeSecret() {
  const cached = window.localStorage.getItem("backoffice-secret");
  if (cached) {
    return cached;
  }

  const secret = window.prompt("Enter the backoffice secret");
  if (!secret) {
    throw new Error("Backoffice secret is required");
  }

  window.localStorage.setItem("backoffice-secret", secret);
  return secret;
}

async function fetchJobHeader() {
  const jobNo = jobNoInput.value.trim();
  if (!jobNo) {
    renderMessage("Enter a JobNo.");
    return;
  }

  currentJobNo = jobNo;
  searchButton.disabled = true;
  renderMessage("Loading...");

  try {
    const secret = getBackofficeSecret();
    const response = await fetch(
      "/api/backoffice/job-header/" + encodeURIComponent(jobNo),
      {
        headers: {
          "x-backoffice-secret": secret,
        },
      },
    );

    if (!response.ok) {
      if (response.status === 403) {
        window.localStorage.removeItem("backoffice-secret");
      }

      throw new Error(await response.text());
    }

    const payload = await response.json();
    renderJobHeader(payload);
  } catch (error) {
    renderMessage(error instanceof Error ? error.message : "Request failed");
  } finally {
    searchButton.disabled = false;
  }
}

async function scheduleJob() {
  if (!currentJobNo) {
    renderMessage("Search for a JobNo first.");
    return;
  }

  const confirmed = await openConfirmModal();
  if (!confirmed) {
    return;
  }

  const scheduleButton = document.getElementById("scheduleButton");
  if (scheduleButton) {
    scheduleButton.disabled = true;
  }

  renderMessage("Updating JobStatus...");

  try {
    const secret = getBackofficeSecret();
    const response = await fetch(
      "/api/backoffice/job-header/" +
        encodeURIComponent(currentJobNo) +
        "/schedule",
      {
        method: "PATCH",
        headers: {
          "x-backoffice-secret": secret,
        },
      },
    );

    if (!response.ok) {
      if (response.status === 403) {
        window.localStorage.removeItem("backoffice-secret");
      }

      throw new Error(await response.text());
    }

    const payload = await response.json();
    renderJobHeader(payload);
  } catch (error) {
    renderMessage(error instanceof Error ? error.message : "Request failed");
  }
}

searchButton.addEventListener("click", fetchJobHeader);
jobNoInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    fetchJobHeader();
  }
});
confirmCancelButton.addEventListener("click", () => {
  closeConfirmModal(false);
});
confirmApproveButton.addEventListener("click", () => {
  closeConfirmModal(true);
});
confirmBackdrop.addEventListener("click", () => {
  closeConfirmModal(false);
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !confirmModal.hidden) {
    closeConfirmModal(false);
  }
});

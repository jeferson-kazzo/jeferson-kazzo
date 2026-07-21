import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const token = process.env.PRIVATE_STATS_TOKEN;
const profileOwner = process.env.GITHUB_REPOSITORY_OWNER;
const outputPath = process.env.OUTPUT_PATH ?? "profile/top-langs.svg";
const languageLimit = Number.parseInt(process.env.LANGS_COUNT ?? "6", 10);

if (!token) throw new Error("O segredo README_STATS_TOKEN nao foi configurado.");
if (!profileOwner) throw new Error("GITHUB_REPOSITORY_OWNER nao esta disponivel.");

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "profile-private-language-stats",
};

async function github(path) {
  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`GitHub API ${response.status}: ${message}`);
  }
  return response.json();
}

const repositories = [];
for (let page = 1; ; page += 1) {
  const params = new URLSearchParams({
    visibility: "all",
    affiliation: "owner,collaborator,organization_member",
    per_page: "100",
    page: String(page),
  });
  const batch = await github(`/user/repos?${params}`);
  repositories.push(...batch);
  if (batch.length < 100) break;
}

const includedRepositories = repositories.filter((repository) => {
  if (repository.fork || repository.archived) return false;
  const ownedByProfile = repository.owner.login.toLowerCase() === profileOwner.toLowerCase();
  return ownedByProfile || repository.private;
});

const totals = new Map();
for (const repository of includedRepositories) {
  const owner = encodeURIComponent(repository.owner.login);
  const name = encodeURIComponent(repository.name);
  const languages = await github(`/repos/${owner}/${name}/languages`);
  for (const [language, bytes] of Object.entries(languages)) {
    totals.set(language, (totals.get(language) ?? 0) + Number(bytes));
  }
}

const totalBytes = [...totals.values()].reduce((sum, bytes) => sum + bytes, 0);
const languages = [...totals.entries()]
  .sort((left, right) => right[1] - left[1])
  .slice(0, Math.max(1, languageLimit))
  .map(([name, bytes]) => ({ name, bytes, percentage: (bytes / totalBytes) * 100 }));

const knownColors = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Python: "#3572a5",
  PowerShell: "#012456",
  Shell: "#89e051",
  PLpgSQL: "#336790",
  SQL: "#e38c00",
  Java: "#b07219",
  "C#": "#178600",
  C: "#555555",
  "C++": "#f34b7d",
  PHP: "#4f5d95",
  Go: "#00add8",
  Rust: "#dea584",
  Dart: "#00b4ab",
  Kotlin: "#a97bff",
  Vue: "#41b883",
};
const fallbackColors = ["#7957d5", "#539bf5", "#ff3860", "#2bbc8a", "#f7df1e", "#c6538c"];

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function colorFor(language, index) {
  return knownColors[language] ?? fallbackColors[index % fallbackColors.length];
}

function renderCard() {
  const width = 400;
  const height = 180;

  if (!languages.length || !totalBytes) {
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sem dados de linguagens"><text x="24" y="90" fill="#1d87da" font-family="Segoe UI, Ubuntu, sans-serif" font-size="14" font-weight="600">Sem dados de linguagens.</text></svg>`;
  }

  let progressX = 0;
  const progress = languages.map((language, index) => {
    const segmentWidth = index === languages.length - 1
      ? width - 48 - progressX
      : ((width - 48) * language.percentage) / 100;
    const rect = `<rect x="${progressX.toFixed(2)}" y="0" width="${Math.max(segmentWidth, 1).toFixed(2)}" height="8" fill="${colorFor(language.name, index)}"/>`;
    progressX += segmentWidth;
    return rect;
  }).join("");

  const labels = languages.map((language, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = column === 0 ? 24 : 214;
    const y = 66 + row * 34;
    const color = colorFor(language.name, index);
    const percentage = language.percentage.toLocaleString("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return `<g transform="translate(${x} ${y})"><circle cx="5" cy="-4" r="5" fill="${color}"/><text x="17" y="0" fill="#1d87da" font-family="Segoe UI, Ubuntu, sans-serif" font-size="12"><tspan font-weight="600">${escapeXml(language.name)}</tspan><tspan> ${percentage}%</tspan></text></g>`;
  }).join("");

  const summary = languages.map((language) => `${language.name} ${language.percentage.toFixed(1)}%`).join(", ");
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc"><title id="title">Linguagens mais usadas</title><desc id="desc">${escapeXml(summary)}</desc><rect x="0.5" y="0.5" width="399" height="179" rx="4.5" fill="#0000" stroke="#e4e2e2" stroke-opacity="0"/><g transform="translate(24 26)"><rect width="352" height="8" rx="4" fill="#e4e2e2"/>${progress}</g>${labels}</svg>`;
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, renderCard(), "utf8");
console.log(`Cartao gerado com ${languages.length} linguagens de ${includedRepositories.length} repositorios.`);

import fs from "fs/promises";
import fetch from "node-fetch";
import { DateTime } from "luxon";
import { formatDistanceToNow } from "date-fns";

async function fetchLatestCommit(username, repo) {
  const res = await fetch(`https://api.github.com/repos/${username}/${repo}/commits`);
  const data = await res.json();
  return {
    message: data[0]?.commit?.message || "No commits",
    date: data[0]?.commit?.author?.date || null
  };
}

async function fetchOpenPRs(username) {
  const res = await fetch(`https://api.github.com/search/issues?q=author:${username}+type:pr+is:open`);
  const data = await res.json();
  return data.total_count || 0;
}

async function fetchWakatimeStats() {
  const wakatimeUsername = process.env.WAKATIME_USERNAME;
  const wakatimeApiKey = process.env.WAKATIME_API_KEY;
  if (!wakatimeUsername || !wakatimeApiKey) return "No data";

  const res = await fetch(
    `https://wakatime.com/api/v1/users/${wakatimeUsername}/stats/last_7_days?api_key=${wakatimeApiKey}`
  );
  const data = await res.json();
  return data?.data?.human_readable_total || "No data";
}

function generateSection({ greeting, nowWorking, latestCommit, openPRs, wakatime }) {
  return `
${greeting}

- 🔭 Currently working on **${nowWorking}**
- 📝 Latest commit: *${latestCommit.message}* (${latestCommit.date ? formatDistanceToNow(new Date(latestCommit.date)) + " ago" : "unknown"})
- 📬 Open pull requests: **${openPRs}**
- ⏱️ WakaTime (last 7 days): **${wakatime}**
`.trim();
}

async function main() {
  const username = "syed-hassan-ux"; // change if needed
  const repoName = username; // for profile repo, usually same as username

  const greeting = `### Hey there! 👋 — ${DateTime.now().toLocaleString(DateTime.DATETIME_MED)}`;
  const nowWorking = "Multiple AI & automation projects 🚀";

  const [latestCommit, openPRs, wakatime] = await Promise.all([
    fetchLatestCommit(username, repoName),
    fetchOpenPRs(username),
    fetchWakatimeStats()
  ]);

  const generatedSection = generateSection({
    greeting,
    nowWorking,
    latestCommit,
    openPRs,
    wakatime
  });

  const startMarker = "<!-- AUTO-GENERATED: START -->";
  const endMarker = "<!-- AUTO-GENERATED: END -->";

  // Read existing README
  let existing;
  try {
    existing = await fs.readFile("README.md", "utf8");
  } catch {
    existing = `${startMarker}\n${endMarker}`;
  }

  const newBlock = `${startMarker}\n${generatedSection}\n${endMarker}`;
  let updatedReadme;

  if (existing.includes(startMarker) && existing.includes(endMarker)) {
    const regex = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
    updatedReadme = existing.replace(regex, newBlock);
  } else {
    updatedReadme = `${newBlock}\n\n${existing}`;
  }

  await fs.writeFile("README.md", updatedReadme, "utf8");
  console.log("✅ README updated — static content preserved.");
}

main().catch(err => {
  console.error("❌ Error updating README:", err);
  process.exit(1);
});

import fs from "fs/promises";
import { DateTime } from "luxon";
import { formatDistanceToNow } from "date-fns";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Native fetch is available in Node 20+, no import needed

async function fetchLatestCommit(username, repo) {
  const res = await fetch(`https://api.github.com/repos/${username}/${repo}/commits`);
  if (!res.ok) throw new Error(`Failed to fetch commits: ${res.status}`);
  const data = await res.json();
  return {
    message: data[0]?.commit?.message || "No commits",
    date: data[0]?.commit?.author?.date || null
  };
}

async function fetchOpenPRs(username) {
  const res = await fetch(`https://api.github.com/search/issues?q=author:${username}+type:pr+is:open`);
  if (!res.ok) throw new Error(`Failed to fetch PRs: ${res.status}`);
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
  if (!res.ok) throw new Error(`Failed to fetch WakaTime stats: ${res.status}`);
  const data = await res.json();
  return data?.data?.human_readable_total || "No data";
}

async function fetchRecentEvents(username) {
  const res = await fetch(`https://api.github.com/users/${username}/events/public`);
  if (!res.ok) return { pushes: 0, prsOpened: 0, issuesOpened: 0, stars: 0 };
  const events = await res.json();

  let pushes = 0;
  let prsOpened = 0;
  let issuesOpened = 0;
  let stars = 0;

  for (const ev of events) {
    if (ev.type === "PushEvent") pushes += ev.payload?.size || 0;
    if (ev.type === "PullRequestEvent" && ev.payload?.action === "opened") prsOpened += 1;
    if (ev.type === "IssuesEvent" && ev.payload?.action === "opened") issuesOpened += 1;
    if (ev.type === "WatchEvent") stars += 1;
  }
  return { pushes, prsOpened, issuesOpened, stars };
}

async function generateAIDevlog({ username, latestCommit, openPRs, wakatime, recent }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = [
    "You are generating a concise, friendly daily devlog for a GitHub profile README.",
    `User: ${username}`,
    `Latest commit message: ${latestCommit.message}`,
    `Latest commit time: ${latestCommit.date ? formatDistanceToNow(new Date(latestCommit.date)) + " ago" : "unknown"}`,
    `Open PRs: ${openPRs}`,
    `WakaTime (last 7 days): ${wakatime}`,
    `Recent activity — pushes: ${recent.pushes}, PRs opened: ${recent.prsOpened}, issues opened: ${recent.issuesOpened}, stars: ${recent.stars}`,
    "Write exactly 3 bullet points in markdown, each 1 sentence, energetic but professional, no emojis except rocket. Keep under 300 chars total."
  ].join("\n");

  try {
    const result = await model.generateContent(prompt);
    const text = result.response?.text?.() || result.response?.candidates?.[0]?.content?.parts?.[0]?.text || null;
    return text?.trim() || null;
  } catch (err) {
    console.error("Gemini summarization failed:", err);
    return null;
  }
}

function generateSection({ greeting, nowWorking, latestCommit, openPRs, wakatime, aiDevlog }) {
  return `
${greeting}

${aiDevlog ? `#### AI Daily Devlog\n\n${aiDevlog}\n` : ""}
- 🔭 Currently working on **${nowWorking}**
- 📝 Latest commit: *${latestCommit.message}* (${latestCommit.date ? formatDistanceToNow(new Date(latestCommit.date)) + " ago" : "unknown"})
- 📬 Open pull requests: **${openPRs}**
- ⏱️ WakaTime (last 7 days): **${wakatime}**
`.trim();
}

async function main() {
  const username = "SyedHassanUlHaq";
  const repoName = username; // for profile repo, usually same as username

  const greeting = `### Hey there! 👋 — ${DateTime.now().toLocaleString(DateTime.DATETIME_MED)}`;
  const nowWorking = "Multiple AI & automation projects 🚀";

  const [latestCommit, openPRs, wakatime, recent] = await Promise.all([
    fetchLatestCommit(username, repoName),
    fetchOpenPRs(username),
    fetchWakatimeStats(),
    fetchRecentEvents(username)
  ]);

  const aiDevlog = await generateAIDevlog({ username, latestCommit, openPRs, wakatime, recent });

  const generatedSection = generateSection({
    greeting,
    nowWorking,
    latestCommit,
    openPRs,
    wakatime,
    aiDevlog
  });

  const startMarker = "<!-- AUTO-GENERATED-START -->";
  const endMarker = "<!-- AUTO-GENERATED-END -->";

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

export function profileUiHtml(apiKeyRequired: boolean): string {
  const apiKeyField = apiKeyRequired
    ? `
          <label class="field key-field">
            <span>API key</span>
            <input id="api-key" name="apiKey" type="password" autocomplete="off" placeholder="Enter your API key" required>
          </label>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Turn a LinkedIn profile URL into structured JSON.">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='18' fill='%2315221d'/%3E%3Ctext x='32' y='40' text-anchor='middle' font-family='Arial' font-size='24' font-weight='700' fill='white'%3ELI%3C/text%3E%3C/svg%3E">
  <title>LinkedIn Profile API</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #15221d;
      --muted: #607068;
      --line: #dce5df;
      --paper: #ffffff;
      --wash: #f4f7f4;
      --green: #1d6b4f;
      --green-dark: #13513b;
      --mint: #d9eee5;
      --danger: #9d2f2f;
      --shadow: 0 22px 70px rgba(26, 58, 44, 0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at 12% 6%, rgba(145, 206, 179, 0.35), transparent 29rem),
        radial-gradient(circle at 92% 18%, rgba(242, 211, 149, 0.25), transparent 25rem),
        var(--wash);
    }
    a { color: inherit; }
    .shell { width: min(1100px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 60px; }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 58px; }
    .brand { display: flex; align-items: center; gap: 11px; font-weight: 760; letter-spacing: -0.02em; }
    .mark { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 11px; background: var(--ink); color: white; font-size: 13px; }
    nav { display: flex; gap: 18px; font-size: 14px; color: var(--muted); }
    nav a { text-decoration: none; }
    nav a:hover { color: var(--green); }
    .hero { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr); gap: 60px; align-items: center; }
    .eyebrow { color: var(--green); text-transform: uppercase; letter-spacing: 0.14em; font-weight: 760; font-size: 12px; }
    h1 { margin: 16px 0 18px; max-width: 760px; font-size: clamp(42px, 7vw, 76px); line-height: 0.98; letter-spacing: -0.065em; font-weight: 760; }
    .lede { max-width: 650px; margin: 0; color: var(--muted); line-height: 1.7; font-size: 17px; }
    .badges { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 28px; }
    .badge { padding: 8px 11px; border: 1px solid var(--line); border-radius: 999px; background: rgba(255,255,255,.65); color: #46564e; font-size: 12px; font-weight: 650; }
    .form-card { position: relative; padding: 26px; border: 1px solid rgba(255,255,255,.9); border-radius: 24px; background: rgba(255,255,255,.86); box-shadow: var(--shadow); backdrop-filter: blur(16px); }
    .form-card:before { content: ""; position: absolute; inset: 10px -10px -10px 10px; z-index: -1; border-radius: inherit; background: var(--mint); opacity: .55; }
    .form-card h2 { margin: 0 0 7px; font-size: 20px; letter-spacing: -0.025em; }
    .form-card p { margin: 0 0 22px; color: var(--muted); font-size: 13px; line-height: 1.55; }
    .field { display: block; margin-bottom: 15px; }
    .field span { display: block; margin-bottom: 7px; font-size: 12px; font-weight: 720; }
    input { width: 100%; min-height: 48px; border: 1px solid var(--line); border-radius: 12px; padding: 0 13px; background: white; color: var(--ink); font: inherit; font-size: 14px; outline: none; transition: border-color .2s, box-shadow .2s; }
    input:focus { border-color: #6ca88e; box-shadow: 0 0 0 4px rgba(63, 142, 107, .12); }
    button { width: 100%; min-height: 49px; border: 0; border-radius: 12px; background: var(--green); color: white; font: inherit; font-weight: 730; cursor: pointer; transition: transform .15s, background .2s; }
    button:hover { background: var(--green-dark); }
    button:active { transform: translateY(1px); }
    button:disabled { opacity: .65; cursor: wait; }
    .fine-print { margin: 13px 0 0 !important; text-align: center; font-size: 11px !important; }
    .status { display: none; margin: 34px 0 0; padding: 15px 17px; border-radius: 13px; background: var(--mint); color: var(--green-dark); line-height: 1.5; font-size: 14px; }
    .status.visible { display: block; }
    .status.error { background: #f7e2e0; color: var(--danger); }
    .results { display: none; margin-top: 70px; }
    .results.visible { display: block; }
    .profile-head { display: flex; align-items: center; gap: 18px; margin-bottom: 25px; }
    .avatar { display: none; width: 78px; height: 78px; border-radius: 22px; object-fit: cover; background: var(--mint); }
    .avatar.visible { display: block; }
    .profile-head h2 { margin: 0 0 5px; font-size: 31px; letter-spacing: -0.045em; }
    .profile-head p { margin: 3px 0; color: var(--muted); }
    .meta-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 9px; }
    .meta-pill { padding: 5px 8px; border-radius: 7px; background: var(--mint); color: var(--green-dark); font-size: 11px; font-weight: 700; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .panel { min-width: 0; padding: 22px; border: 1px solid var(--line); border-radius: 18px; background: rgba(255,255,255,.82); }
    .panel.wide { grid-column: 1 / -1; }
    .panel h3 { margin: 0 0 15px; font-size: 14px; letter-spacing: .01em; }
    .panel .empty { color: var(--muted); font-size: 13px; }
    .about { white-space: pre-wrap; color: #43534b; line-height: 1.65; font-size: 14px; }
    .entry { padding: 13px 0; border-top: 1px solid var(--line); }
    .entry:first-child { padding-top: 0; border-top: 0; }
    .entry strong { display: block; font-size: 14px; }
    .entry span { display: block; margin-top: 4px; color: var(--muted); line-height: 1.45; font-size: 12px; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip { padding: 7px 10px; border-radius: 9px; background: #eef3ef; font-size: 12px; }
    details { margin-top: 18px; }
    summary { cursor: pointer; color: var(--muted); font-size: 13px; }
    pre { overflow: auto; max-height: 560px; padding: 18px; border-radius: 14px; background: #14211c; color: #dceae3; font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }
    footer { margin-top: 54px; color: var(--muted); text-align: center; font-size: 12px; }
    @media (max-width: 820px) {
      .topbar { margin-bottom: 38px; }
      .hero { grid-template-columns: 1fr; gap: 38px; }
      h1 { font-size: clamp(44px, 14vw, 66px); }
      .grid { grid-template-columns: 1fr; }
      .panel.wide { grid-column: auto; }
    }
    @media (max-width: 520px) {
      .shell { width: min(100% - 22px, 1100px); padding-top: 18px; }
      nav { gap: 12px; font-size: 12px; }
      .form-card { padding: 20px; }
      .profile-head { align-items: flex-start; }
      .avatar { width: 62px; height: 62px; border-radius: 17px; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div class="brand"><span class="mark">LI</span><span>Profile API</span></div>
      <nav><a href="/docs">API docs</a><a href="/health">Status</a><a href="https://github.com/Subramanyarao11/linkedin-profile-api">GitHub</a></nav>
    </header>

    <section class="hero">
      <div>
        <div class="eyebrow">Structured profile data</div>
        <h1>One profile URL. Clean JSON.</h1>
        <p class="lede">Extract the information visible to the configured LinkedIn session—name, headline, about, work history, education, skills, certifications, languages, and images—without asking the caller to log in.</p>
        <div class="badges"><span class="badge">HTTPS API</span><span class="badge">Strict URL validation</span><span class="badge">JSON response</span><span class="badge">Interactive docs</span></div>
      </div>

      <form id="profile-form" class="form-card">
        <h2>Try a profile</h2>
        <p>Paste a public LinkedIn <code>/in/...</code> profile URL. Results depend on profile visibility.</p>
        <label class="field">
          <span>LinkedIn profile URL</span>
          <input id="profile-url" name="url" type="url" inputmode="url" placeholder="https://www.linkedin.com/in/username/" pattern="https://([a-z0-9-]+\\.)?linkedin\\.com/in/.+" required autofocus>
        </label>${apiKeyField}
        <button id="submit-button" type="submit">Extract profile</button>
        <p class="fine-print">No LinkedIn credentials are requested from API users.</p>
      </form>
    </section>

    <div id="status" class="status" role="status" aria-live="polite"></div>
    <section id="results" class="results" aria-live="polite">
      <div class="profile-head">
        <img id="avatar" class="avatar" alt="Profile image">
        <div>
          <h2 id="profile-name"></h2>
          <p id="headline"></p>
          <p id="location"></p>
          <div id="meta" class="meta-row"></div>
        </div>
      </div>
      <div class="grid">
        <article class="panel wide"><h3>About</h3><div id="about" class="about"></div></article>
        <article class="panel"><h3>Experience</h3><div id="experience"></div></article>
        <article class="panel"><h3>Education</h3><div id="education"></div></article>
        <article class="panel"><h3>Skills</h3><div id="skills" class="chips"></div></article>
        <article class="panel"><h3>Certifications</h3><div id="certifications"></div></article>
        <article class="panel"><h3>Languages</h3><div id="languages" class="chips"></div></article>
        <article class="panel"><h3>Warnings</h3><div id="warnings"></div></article>
      </div>
      <details><summary>View raw JSON response</summary><pre id="raw-json"></pre></details>
    </section>
    <footer>Built as a technical demonstration. Data is never guessed; unavailable fields remain empty.</footer>
  </main>

  <script>
    const API_KEY_REQUIRED = ${JSON.stringify(apiKeyRequired)};
    const form = document.getElementById("profile-form");
    const button = document.getElementById("submit-button");
    const statusBox = document.getElementById("status");
    const results = document.getElementById("results");

    function setText(id, value, fallback) {
      document.getElementById(id).textContent = value || fallback || "";
    }

    function empty(container, message) {
      container.replaceChildren();
      const element = document.createElement("span");
      element.className = "empty";
      element.textContent = message;
      container.append(element);
    }

    function entryList(id, values, title, subtitle) {
      const container = document.getElementById(id);
      container.replaceChildren();
      if (!values || values.length === 0) return empty(container, "Not available on this profile.");
      values.forEach(function (value) {
        const entry = document.createElement("div");
        entry.className = "entry";
        const strong = document.createElement("strong");
        strong.textContent = title(value);
        entry.append(strong);
        const detail = subtitle(value);
        if (detail) {
          const span = document.createElement("span");
          span.textContent = detail;
          entry.append(span);
        }
        container.append(entry);
      });
    }

    function chips(id, values, label) {
      const container = document.getElementById(id);
      container.replaceChildren();
      if (!values || values.length === 0) return empty(container, "Not available on this profile.");
      values.forEach(function (value) {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = label(value);
        container.append(chip);
      });
    }

    function yearMonth(value) {
      if (!value) return "";
      return (value.month ? String(value.month).padStart(2, "0") + "/" : "") + value.year;
    }

    function dates(value) {
      if (!value) return "";
      return [yearMonth(value.start), value.isCurrent ? "Present" : yearMonth(value.end)].filter(Boolean).join(" – ");
    }

    function render(payload) {
      const profile = payload.data;
      const meta = payload.meta;
      setText("profile-name", profile.name.full, "Profile");
      setText("headline", profile.headline, "Headline not available");
      setText("location", profile.location, "Location not available");
      setText("about", profile.about, "About information is not available on this profile.");

      const avatar = document.getElementById("avatar");
      avatar.classList.remove("visible");
      if (profile.profileImages && profile.profileImages.profile) {
        try {
          const avatarUrl = new URL(profile.profileImages.profile);
          if (avatarUrl.protocol === "https:") {
            avatar.src = avatarUrl.href;
            avatar.classList.add("visible");
          }
        } catch (_) {}
      }

      const metaContainer = document.getElementById("meta");
      metaContainer.replaceChildren();
      [meta.cache === "hit" ? "Cached" : "Fresh", meta.durationMs + " ms", profile.source.partial ? "Partial" : "Complete"].forEach(function (text) {
        const pill = document.createElement("span");
        pill.className = "meta-pill";
        pill.textContent = text;
        metaContainer.append(pill);
      });

      entryList("experience", profile.experience, function (item) { return item.title; }, function (item) {
        return [item.company, item.location, dates(item.dateRange)].filter(Boolean).join(" · ");
      });
      entryList("education", profile.education, function (item) { return item.school; }, function (item) {
        return [item.degree, item.fieldOfStudy, dates(item.dateRange)].filter(Boolean).join(" · ");
      });
      chips("skills", profile.skills, function (item) { return item.name; });
      entryList("certifications", profile.certifications, function (item) { return item.name; }, function (item) {
        return [item.authority, dates(item.dateRange)].filter(Boolean).join(" · ");
      });
      chips("languages", profile.languages, function (item) {
        return item.proficiency ? item.name + " · " + item.proficiency : item.name;
      });
      entryList("warnings", meta.warnings || [], function (item) { return item; }, function () { return ""; });
      document.getElementById("raw-json").textContent = JSON.stringify(payload, null, 2);
      results.classList.add("visible");
      results.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      results.classList.remove("visible");
      statusBox.className = "status visible";
      statusBox.textContent = "Loading the profile and collecting visible sections. This can take several seconds; a sleeping free host can take about a minute to wake.";
      button.disabled = true;
      button.textContent = "Extracting…";
      const headers = { "content-type": "application/json" };
      if (API_KEY_REQUIRED) headers["x-api-key"] = document.getElementById("api-key").value;
      try {
        const response = await fetch("/v1/profiles", {
          method: "POST",
          headers: headers,
          body: JSON.stringify({ url: document.getElementById("profile-url").value })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error && payload.error.message ? payload.error.message : "The profile request failed.");
        statusBox.className = "status";
        render(payload);
      } catch (error) {
        statusBox.className = "status visible error";
        statusBox.textContent = error instanceof Error ? error.message : "The profile request failed.";
      } finally {
        button.disabled = false;
        button.textContent = "Extract profile";
      }
    });
  </script>
</body>
</html>`;
}

import type { PairingPayload } from './types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderCandidateItems(payload: PairingPayload): string {
  return payload.connection.candidates
    .map((candidate) => {
      const preferredLabel = candidate.isPreferred ? ' (preferred)' : '';
      const scopeLabel = candidate.isInternal ? 'loopback only' : 'LAN reachable';
      return `<li>
        <strong>${escapeHtml(candidate.address)}</strong>${escapeHtml(preferredLabel)}
        <div>HTTP: <a href="${escapeHtml(candidate.pairingUrl)}">${escapeHtml(candidate.pairingUrl)}</a></div>
        <div>WebSocket fallback: <code>${escapeHtml(candidate.wsUrl)}</code></div>
        <div>${escapeHtml(candidate.interfaceName)} · ${escapeHtml(candidate.family)} · ${escapeHtml(scopeLabel)}</div>
      </li>`;
    })
    .join('');
}

function renderProjectItems(payload: PairingPayload): string {
  if (payload.projects.length === 0) {
    return '<li>No projects loaded from projects.json</li>';
  }
  return payload.projects
    .map(
      (project) =>
        `<li><code>${escapeHtml(project.id)}</code> ${escapeHtml(project.name)}</li>`,
    )
    .join('');
}

const DASHBOARD_STYLES = `
  :root {
    color-scheme: light;
    --bg: #f3efe5;
    --panel: #fffdf8;
    --ink: #182126;
    --muted: #58636b;
    --accent: #0a7f5a;
    --border: #d8d0c0;
  }
  body {
    margin: 0;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background:
      radial-gradient(circle at top right, rgba(10, 127, 90, 0.12), transparent 30%),
      linear-gradient(180deg, #f7f2e8 0%, var(--bg) 100%);
    color: var(--ink);
  }
  main { max-width: 920px; margin: 0 auto; padding: 32px 20px 48px; }
  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 18px;
    padding: 20px;
    box-shadow: 0 20px 50px rgba(24, 33, 38, 0.08);
  }
  h1, h2 { margin: 0 0 12px; }
  p, li, code, pre { line-height: 1.5; }
  a { color: var(--accent); }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  pre { overflow-x: auto; padding: 16px; border-radius: 14px; background: #172127; color: #f2f7f5; }
  ul { padding-left: 20px; }
  .grid { display: grid; gap: 16px; }
  @media (min-width: 760px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
`;

export function renderDashboard(payload: PairingPayload): string {
  const candidateItems = renderCandidateItems(payload);
  const projectItems = renderProjectItems(payload);
  const payloadJson = escapeHtml(JSON.stringify(payload, null, 2));

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(payload.serverName)} Pairing</title>
    <style>${DASHBOARD_STYLES}</style>
  </head>
  <body>
    <main>
      <section class="panel">
        <p>Claude Relay Pairing</p>
        <h1>${escapeHtml(payload.serverName)}</h1>
        <p>Scan or copy the pairing URL on your phone. The mobile app should fetch pairing metadata first, then connect to the preferred WebSocket URL it receives.</p>
        <p><strong>QR-friendly value:</strong> <code>${escapeHtml(payload.qr.value)}</code></p>
      </section>
      <div class="grid" style="margin-top: 16px;">
        <section class="panel">
          <h2>Connection Targets</h2>
          <ul>${candidateItems}</ul>
        </section>
        <section class="panel">
          <h2>Projects</h2>
          <ul>${projectItems}</ul>
          <p>Manual fallback remains available. A client can still connect directly to <code>${escapeHtml(
            payload.connection.preferred.wsUrl,
          )}</code>.</p>
        </section>
      </div>
      <section class="panel" style="margin-top: 16px;">
        <h2>Pairing Payload</h2>
        <pre>${payloadJson}</pre>
      </section>
    </main>
  </body>
</html>`;
}

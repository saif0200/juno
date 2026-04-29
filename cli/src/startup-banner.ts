import os from 'os';
import qrcode from 'qrcode-terminal';

import { PORT, PUBLIC_URL, SERVER_ID, SERVER_NAME, TMUX_AVAILABLE, TMUX_BINARY } from './config';
import { collectConnectionCandidates } from './pairing';
import { getProjects } from './state';

export function printStartupBanner(): void {
  const projects = getProjects();
  const discoveryCandidates = collectConnectionCandidates().filter(
    (candidate) => !candidate.isInternal,
  );
  const configuredProjectCount = projects.filter((project) => project.source === 'config').length;
  const discoveredProjectCount = projects.filter((project) => project.source === 'discovered').length;

  console.log(`🖥️  Host: ${os.platform()} ${os.release()}`);
  console.log(
    `📁 Projects: ${configuredProjectCount} configured, ${discoveredProjectCount} discovered`,
  );
  console.log(`📡 Server: ${SERVER_NAME} (${SERVER_ID})`);
  console.log(`🧩 Session bridge: ${TMUX_AVAILABLE ? `tmux (${TMUX_BINARY})` : 'direct PTY'}`);
  console.log(`🌐 Local:   http://localhost:${PORT}/dashboard`);

  if (PUBLIC_URL) {
    const tunnelPairingUrl = `${PUBLIC_URL}/pairing`;
    console.log(`🌍 Tunnel:  ${tunnelPairingUrl}`);
    console.log('');
    console.log('Scan with Juno to pair your phone (tunnel):');
    qrcode.generate(tunnelPairingUrl, { small: true });
  } else {
    const preferredCandidate =
      discoveryCandidates.find((c) => c.family === 'IPv4') ?? discoveryCandidates[0];

    if (preferredCandidate) {
      const rawHostname = os.hostname();
      const mdnsHost = rawHostname.endsWith('.local') ? rawHostname : `${rawHostname}.local`;
      const mdnsPairingUrl = `http://${mdnsHost}:${PORT}/pairing`;

      console.log(`📱 mDNS:    ${mdnsPairingUrl}`);
      console.log(`📱 LAN IP:  ${preferredCandidate.pairingUrl}`);
      console.log('');
      console.log('Scan with Juno to pair your phone:');
      qrcode.generate(mdnsPairingUrl, { small: true });
    } else {
      console.log('');
      console.log('No LAN interface found - phone pairing requires a network connection.');
    }
  }

  console.log('✅ Ready to accept connections');
}

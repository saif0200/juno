const WebSocket = require('ws');

const serverUrl = process.env.WS_URL || 'ws://localhost:3000';
const initialInput = process.env.INITIAL_INPUT || '';

const socket = new WebSocket(serverUrl);

socket.on('open', () => {
  console.log(`connected: ${serverUrl}`);
});

socket.on('message', (raw) => {
  const text = raw.toString();
  const message = JSON.parse(text);

  if (message.type === 'session_created') {
    console.log(`session: ${message.sessionId}`);
    if (initialInput.length > 0) {
      socket.send(
        JSON.stringify({
          type: 'terminal_input',
          data: initialInput,
        }),
      );
    }
    return;
  }

  if (message.type === 'terminal_output' || message.type === 'terminal_snapshot') {
    process.stdout.write(message.data);
    return;
  }

  console.log(text);
});

socket.on('close', (code, reason) => {
  console.log(`closed: ${code} ${reason.toString()}`);
  process.exit(0);
});

socket.on('error', (error) => {
  console.error(error);
  process.exit(1);
});

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', (chunk) => {
  const data = chunk.toString('utf8');

  if (data === '\u001c') {
    socket.close();
    return;
  }

  socket.send(
    JSON.stringify({
      type: 'terminal_input',
      data,
    }),
  );
});

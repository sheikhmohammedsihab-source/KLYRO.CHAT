import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const styles = fs.readFileSync(path.join(__dirname, 'src/app/styles.css'), 'utf-8');
const markup = fs.readFileSync(path.join(__dirname, 'src/app/markup.html'), 'utf-8');

const jsFiles = [
  'src/app/contract_and_config.js',
  'src/app/state_and_store.js',
  'src/app/media_engine.js',
  'src/app/core_ui_and_events.js',
  'src/app/status_engine.js',
  'src/app/posts_and_pulse.js',
  'src/app/profile_engine.js',
  'src/app/discover_and_presence.js',
  'src/app/gif_engine.js',
  'src/app/chat_and_calls.js',
  'src/app/auth_and_boot.js'
];

let jsBundle = jsFiles.map(file => {
  return fs.readFileSync(path.join(__dirname, file), 'utf-8');
}).join('\n\n');

jsBundle += '\n\n/* Launch KLYRO */\nbootKlyro();\n';

const finalHTML = `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#2563EB">
<title>KLYRO</title>
<meta name="description" content="KLYRO — Fast, private, real-time messaging with live stories, discover, voice and WebRTC calls.">
<meta property="og:title" content="KLYRO">
<meta property="og:description" content="Fast, private, real-time messaging with live stories, discover, voice and WebRTC calls.">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<script>
// Global cross-origin script error protection for embedded iframe environment
window.addEventListener('error', function(e) {
  if (e && (e.message === 'Script error.' || (e.filename && e.filename.indexOf('pushalert') !== -1))) {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
    return true;
  }
}, true);
</script>
<style>
${styles}
</style>
</head>
<body>
${markup}

<!-- Firebase SDK Compat v8 -->
<script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js"></script>
<script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-auth.js"></script>
<script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-database.js"></script>

<!-- KLYRO Engine -->
<script>
${jsBundle}
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), finalHTML, 'utf-8');
console.log('Successfully generated index.html (' + finalHTML.length + ' bytes)');

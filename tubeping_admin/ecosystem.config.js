const fs = require('fs');
const path = require('path');

// .env.local 파일에서 환경변수 로드
function loadEnvFile(filePath) {
  const env = {};
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.substring(0, eqIdx).trim();
      const value = trimmed.substring(eqIdx + 1).trim();
      env[key] = value;
    }
  } catch (e) {
    console.error('Failed to load env file:', e.message);
  }
  return env;
}

const envLocal = loadEnvFile(path.join(__dirname, '.env.local'));

module.exports = {
  apps: [{
    name: 'tubeping-admin',
    script: '.next/standalone/shinsananalytics-hub/tuping-admin/tubeping_admin/tubeping_admin/server.js',
    cwd: __dirname,
    env: {
      ...envLocal,
      PORT: 3005,
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
    },
  }],
};

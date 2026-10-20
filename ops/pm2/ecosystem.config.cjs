// PM2 process file for the API (production / staging): `pm2 start ops/pm2/ecosystem.config.cjs`.
// Secrets come from /srv/wewin/shared/.env (never from this file). pg-boss jobs run in the same processes.
module.exports = {
  apps: [
    {
      name: 'wewin-api',
      cwd: '/srv/wewin/current/apps/api',
      script: 'dist/main.js',
      node_args: '--env-file=/srv/wewin/shared/.env',
      instances: 2,
      exec_mode: 'cluster',
      max_memory_restart: '1G',
      kill_timeout: 15000,
      env: { NODE_ENV: 'production', TZ: 'Asia/Kolkata' },
      out_file: '/var/log/wewin/api.out.log',
      error_file: '/var/log/wewin/api.err.log',
      time: true,
    },
  ],
};

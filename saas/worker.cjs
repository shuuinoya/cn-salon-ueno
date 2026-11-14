'use strict';
process.umask(0o077);
// 親が停止・異常終了しても、孤立した店舗サーバーを残さない。
process.on('disconnect', () => process.kill(process.pid,'SIGTERM'));
require('./runtime/server.js');

const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const source = join(__dirname, 'dist');
let page = readFileSync(join(source, 'index.html'), 'utf8');

function replaceText(before, after) {
 if (!page.includes(before)) throw Error('Static page source changed: ' + before);
 page = page.replaceAll(before, after);
}

replaceText('  <script defer src="cloud.js"></script>',
 '  <script defer src="browser-board.js"></script>\n  <script defer src="cloud.js"></script>');
for (const name of ['favicon.svg', 'styles.css', 'scoring.js', 'app.js', 'browser-board.js', 'cloud.js']) {
 readFileSync(join(source, name)); // Fail the build if a published asset is missing.
 replaceText(`="${name}"`, `="./dist/${name}"`);
}

replaceText('正式挑战完成后自动保存到积分榜', '正式成绩自动保存到此浏览器的积分榜');
replaceText('正在连接共享数据…', '正在读取本机数据…');
replaceText('累计参与人数', '本机参与人数');
replaceText('>正式挑战次数<', '>本机挑战次数<');
replaceText('>已提交正式挑战<', '>本机正式挑战<');
replaceText('小队飞行排行榜', '本机飞行排行榜');
replaceText('我的云端历史', '按昵称查看历史');
replaceText('实时积分榜', '本机实时积分榜');
replaceText('开始前填写昵称，完成正式测试后自动保存到共享榜并保留历次成绩。', '开始前填写昵称，正式成绩会保存到此浏览器。排行榜和参与次数仅统计此浏览器中的记录。');
replaceText('练习不上传。', '练习不计入正式成绩。');
replaceText('仅清空本机成绩，云端排行榜和已提交的历史记录不受影响。此操作无法撤销。', '此操作只清空“我的飞行记录”中的最近 50 次展示记录。积分榜和按昵称查询的历史仍可查看。');
replaceText('人数按已提交成绩的昵称档案去重：同一浏览器相同昵称合并，不同设备分开计数。练习和未提交的挑战不计入。', '此榜仅统计当前浏览器。相同昵称的正式成绩合并计为一位玩家，练习和中途退出不计入。');

writeFileSync(join(__dirname, 'index.html'), page);
console.log('Built GitHub Pages entry point with relative assets and browser-only standings.');

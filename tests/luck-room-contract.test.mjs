import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'luck-room/luck-room.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'luck-room/js/luck-room.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'luck-room/css/luck-room.css'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const icons = fs.readFileSync(path.join(root, 'settings/icon-settings.html'), 'utf8');

test('four play modes and exact entertainment disclaimer are present', () => {
  for (const mode of ['抽签', '转盘', '塔罗', '运势']) assert.match(html, new RegExp(mode));
  const disclaimer = '以上内容均为娱乐体验，不具备预测未来或指导现实决策的作用，请勿当真，一切仅供娱乐参考。';
  assert.equal((html.match(new RegExp(disclaimer, 'g')) || []).length, 4);
  assert.match(js, /var DISCLAIMER = '以上内容均为娱乐体验/);
});

test('tarot uses a tall six-corner crystal silhouette, not rectangular playing cards', () => {
  const polygon = 'polygon(50% 1%,89% 15%,89% 78%,50% 99%,11% 78%,11% 15%)';
  assert.ok(css.includes(polygon));
  assert.match(css, /\.tarot-flip-inner[\s\S]*?transform-style:preserve-3d/);
  assert.match(html, /tarot-deck-scene/);
  assert.match(css, /\.tarot-deck-scene\.shuffling[\s\S]*?shuffle-main/);
  assert.match(js, /var TAROT_MINOR = \[/);
  assert.match(js, /var TAROT = TAROT_MAJOR\.concat\(TAROT_MINOR\)/);
  assert.match(html, /完整 78 张牌组/);
  const majorStart = js.indexOf('var TAROT_MAJOR = [');
  const minorStart = js.indexOf('var TAROT_MINOR = [');
  const allCardsStart = js.indexOf('var TAROT = TAROT_MAJOR.concat(TAROT_MINOR)');
  const majorDeck = js.slice(majorStart, minorStart);
  const minorDeck = js.slice(minorStart, allCardsStart);
  assert.equal((majorDeck.match(/^  \['/gm) || []).length, 22, 'Major Arcana must contain 22 cards');
  for (const suit of ['权杖', '圣杯', '宝剑', '星币']) {
    assert.equal((minorDeck.match(new RegExp("suit:'" + suit + "'", 'g')) || []).length, 14, suit + ' must contain 14 cards');
  }
  assert.equal((minorDeck.match(/name:'/g) || []).length, 56, 'Minor Arcana must contain 56 cards');
  assert.match(html, /tarotDeckCount/);
});

test('role participation uses existing MAOMAO character and AI APIs', () => {
  assert.match(html, /phone_storage\.js/);
  assert.match(html, /phone_api\.js/);
  assert.match(html, /phone_context\.js/);
  assert.match(js, /PhoneStorage\.getCharacters/);
  assert.match(js, /PhoneContext\.buildPhoneRoleContext/);
  assert.match(js, /PhoneAPI\.complete/);
  assert.match(js, /function requestRoleStart\(game\)/);
  assert.match(js, /requestRoleStart\('抽签'\)/);
  assert.match(js, /requestRoleStart\('大转盘'\)/);
  assert.match(js, /requestRoleStart\('塔罗牌'\)/);
  assert.match(js, /requestRoleStart\('今日运势'\)/);
  assert.match(js, /roleStartToken\+\+/);
  assert.match(html, /id="rolePrompt"/);
});

test('random results are generated locally before character response', () => {
  assert.match(js, /function randomIndex\(length\)/);
  assert.match(js, /function spinWheel\(\)/);
  assert.match(js, /function drawTarot\(\)/);
  assert.match(js, /function drawDaily\(\)/);
  assert.match(js, /reversedDraw:randomIndex\(100\)<30/);
  assert.match(js, /function askRole\(game, detail, targetId\)/);
  assert.ok(js.indexOf('var index = randomIndex(wheel.items.length)') < js.indexOf("askRole('大转盘'"));
});

test('app is integrated with desktop drag layout and icon customization', () => {
  assert.match(index, /data-drag="app_luckroom"/);
  assert.match(index, /addLuckRoomShortcutToExistingLayouts/);
  assert.match(icons, /id: 'app_luckroom'/);
});

test('custom templates and history have a dedicated persistent data domain', () => {
  assert.match(js, /maomao_luck_room_v1/);
  assert.match(js, /state\.pools/);
  assert.match(js, /state\.wheels/);
  assert.match(js, /state\.history/);
  assert.match(js, /suit:card\.suit/);
  assert.match(html, /deleteLotPoolBtn/);
  assert.match(html, /deleteWheelBtn/);
  assert.match(js, /function saveState\(\)/);
  assert.match(js, /className = 'item-edit-input'/);
  assert.match(js, /function delete|deleteLotPoolBtn/);
  assert.match(js, /localStorage\.setItem\(DATA_KEY/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../forum/forum-detail.html', import.meta.url), 'utf8');
const range = (start, end) => {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'expected markup range missing: ' + start);
  return html.slice(from, to);
};

test('the comments start immediately with their list, with no visible serial tools between', () => {
  const comments = range('<div class="comments">', '<div class="reply-hint"');
  assert.match(comments, /id="commentList"/);
  for (const id of ['gossipReaderTools', 'gossipContinue', 'gossipFinishAll', 'forumWorldTools']) {
    assert.doesNotMatch(comments, new RegExp('id="' + id + '"'));
  }
});

test('existing plus opens a default-collapsed serial actions menu with original action IDs', () => {
  const panel = range('<section id="forumMorePanel"', '</section>');
  assert.match(html, /id="forumMorePanel"[^>]* hidden>/);
  assert.match(html, /id="commentImageButton"[^>]*aria-controls="forumMorePanel"[^>]*aria-expanded="false"/);
  for (const id of ['forumMoreAddImage', 'gossipReaderTools', 'gossipResume', 'gossipJumpLatest',
    'gossipViewAll', 'gossipViewAuthor', 'gossipContinue', 'gossipFinishAll', 'gossipSeriesNote',
    'forumWorldTools', 'forumWorldContinue']) {
    assert.ok(panel.includes('id="' + id + '"'), 'missing original tool ' + id);
    assert.equal(html.split('id="' + id + '"').length, 2, 'duplicate tool ID ' + id);
  }
  assert.match(html, /forumMorePanel\.hidden=!opening/);
  assert.match(html, /e\.key==='Escape'/);
});

test('plus menu retains image upload; original comment composer stays fixed', () => {
  assert.match(html, /forumMoreAddImage\.addEventListener\('click'/);
  assert.match(html, /commentImagesInput\.click\(\)/);
  assert.match(html, /id="commentImages"[^>]*accept="image\/jpeg/);
  assert.match(html, /position: fixed; bottom: var\(--maomao-home-indicator-comment-bottom/);
  assert.match(html, /\.forum-more-panel \{[\s\S]*?bottom:calc\(100% \+ 8px\)/);
  for (const name of ['renderPost()', 'renderComments()', 'sendComment()', 'continueGossip()',
    'finishGossipSeries()', 'continueForumWorld()']) {
    assert.ok(html.includes(name), 'lost existing forum operation: ' + name);
  }
});

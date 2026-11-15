import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const hapticsSource = readFileSync(new URL('../shared/js/haptics.js', import.meta.url), 'utf8');
const soundSource = readFileSync(new URL('../shared/js/sound-system.js', import.meta.url), 'utf8');

function makePage(options = {}) {
    let now = 1000;
    const values = new Map();
    const pulses = [];
    const events = [];
    const listeners = {};
    const page = {
        localStorage: {
            getItem(key) { return values.has(key) ? values.get(key) : null; },
            setItem(key, value) { values.set(key, String(value)); }
        },
        addEventListener(name, fn) { listeners[name] = fn; },
        dispatchEvent(event) { events.push(event); if (listeners[event.type]) listeners[event.type](event); }
    };
    const doc = { visibilityState: 'visible', querySelector() { return null; } };
    const navigator = options.unsupported ? {} : { vibrate(ms) {
        pulses.push(ms);
        if (options.throwOnVibrate) throw new Error('no access');
        return true;
    } };
    const context = {
        window: page,
        document: doc,
        navigator,
        Date: { now() { return now; } },
        CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = opts.detail; } }
    };
    runInNewContext(hapticsSource, context, { filename: 'haptics.js' });
    return {
        api: page.MAOMAOHaptics,
        context, page, doc, pulses, events, values,
        advance(ms) { now += ms; }
    };
}

test('light profiles, cooldown and user-disabled mode', () => {
    const p = makePage();
    assert.equal(p.api.supported(), true);
    assert.equal(p.api.isEnabled(), true);
    assert.equal(p.api.trigger('send'), true);
    assert.deepEqual(p.pulses, [12]);
    p.advance(20);
    assert.equal(p.api.trigger('receive'), false);
    p.advance(80);
    assert.equal(p.api.trigger('receive'), true);
    assert.deepEqual(p.pulses, [12, 9]);
    assert.equal(p.api.trigger('receive'), false);
    p.advance(200);
    assert.equal(p.api.setEnabled(false), true);
    assert.equal(p.values.get('maomao_haptics_enabled_v1'), '0');
    assert.equal(p.api.trigger('send'), false);
    assert.equal(p.api.setEnabled(true), true);
    assert.equal(p.api.trigger('swipe'), true);
    assert.deepEqual(p.pulses, [12, 9, 11]);
});

test('custom event bridge and strictly bounded extension points', () => {
    const p = makePage();
    assert.equal(p.api.register('item-picked', 14), true);
    assert.equal(p.api.register('bad_name!', 10), false);
    assert.equal(p.api.register('too-strong', 100), false);
    p.page.dispatchEvent(new p.context.CustomEvent('maomao:haptic', { detail: { type: 'item-picked' } }));
    assert.deepEqual(p.pulses, [14]);
    p.advance(200);
    assert.equal(p.api.trigger('bad_name!'), false);
    assert.deepEqual(p.pulses, [14]);
});

test('unsupported, background and device errors never break page behavior', () => {
    const unsupported = makePage({ unsupported: true });
    assert.equal(unsupported.api.supported(), false);
    assert.equal(unsupported.api.trigger('navigate'), false);
    const hidden = makePage();
    hidden.doc.visibilityState = 'hidden';
    assert.equal(hidden.api.trigger('receive'), false);
    assert.deepEqual(hidden.pulses, []);
    const throwing = makePage({ throwOnVibrate: true });
    assert.equal(throwing.api.trigger('send'), false);
});

test('existing chat sound events invoke haptics even if sound is muted', () => {
    const p = makePage();
    p.values.set('sound_settings', JSON.stringify({
        send: 'none', receive: 'none', push: 'none', voice: 'none', call: 'none'
    }));
    runInNewContext(soundSource, p.context, { filename: 'sound-system.js' });
    p.context.SoundSystem.play('send');
    p.advance(200);
    p.context.SoundSystem.play('receive', 'synthetic-role');
    p.advance(200);
    p.context.SoundSystem.play('push');
    assert.deepEqual(p.pulses, [12, 9]);
});

test('home page and sound settings retain explicit, non-invasive hooks', () => {
    const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const settings = readFileSync(new URL('../settings/sound-settings.html', import.meta.url), 'utf8');
    assert.match(index, /shared\/js\/haptics\.js/);
    assert.match(index, /cur !== activePageIndex/);
    assert.match(index, /MAOMAOHaptics\.trigger\('swipe'\)/);
    assert.match(settings, /hapticsToggle/);
    assert.match(settings, /aria-checked/);
    assert.match(settings, /haptics\.setEnabled/);
});

'use strict';

import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';


const INACTIVITY_MS   = 2000; // Mouse inactivity time before the overlay appears(ms).
const FADE_TIME_MS    = 1000; // The duration of the overlay's fade-in animation(ms).
const INIT_DELAY_MS   = 6000; // The initial delay before positioning the overlay(ms).
const UNLOCK_DELAY_MS = 6000; // The delay after unlocking the screen before repositioning the overlay(ms).
const ACTIVE_OPACITY  = 0;    // The opacity of the transparent overlay(0-255). 0 = fully transparent
const INIT_RETRIES    = 3;    // The number of times to retry positioning the overlay if it fails.

//Clock
const CLOCK_COLOR        = '#006600';
const CLOCK_SIZE         = 18;  // px
const CLOCK_JITTERX      = 45;  //The maximum horizontal offset by which the clock can randomly shift left or right from its base position(px).
const CLOCK_MARGIN_RIGHT = 60;  // The fixed distance between the clock and the right edge of the overlay(px).
const USE_CUSTOM_FONT = true;   // true -use bundled font (Matrixtype), false -system default font

export default class AMOLEDOverlayExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._overlay = null;
        this._clock = null;

        this._signals = [];
        this._timers = [];
        this._idleTimeout = 0;
        this._initTries = INIT_RETRIES;
    }

    enable() {
        this._overlay = new St.Widget({
            style: 'background-color: black;',
            reactive: false,
            opacity: ACTIVE_OPACITY,
        });

        this._clock = new St.Label({
            text: '',
            style_class: USE_CUSTOM_FONT ? 'clock-label' : null,
            style: USE_CUSTOM_FONT
                ? null
                : `font-size: ${CLOCK_SIZE}px; color: ${CLOCK_COLOR}; font-weight: normal;`,
            visible: false,
        });
        this._overlay.add_child(this._clock);

        Main.layoutManager.addTopChrome(this._overlay, {
            affectsInputRegion: false,
            trackFullscreen: true,
        });

        this._armClockTick();
        this._connectSignals();

        const initTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            INIT_DELAY_MS,
            () => {
                const ok = this._tryInitialPosition();
                if (ok) {
                    this._resetIdleTimer();
                    this._removeTimer(initTimeoutId);
                    return GLib.SOURCE_REMOVE;
                }

                if (--this._initTries > 0) {
                    return GLib.SOURCE_CONTINUE;
                } else {
                    this._removeTimer(initTimeoutId);
                    return GLib.SOURCE_REMOVE;
                }
            }
        );
        this._timers.push(initTimeoutId);
    }

    disable() {
        this._timers.forEach(id => { try { GLib.source_remove(id); } catch {} });
        this._timers = [];
        this._idleTimeout = 0;

        this._disconnectSignals();

        if (this._overlay) {
            Main.layoutManager.removeChrome(this._overlay);
            this._overlay.destroy();
            this._overlay = null;
        }
        this._clock = null;
    }

    // Signals
    _connectSignals() {
        this._connect(global.stage, 'notify::allocation', () => this._tryInitialPosition());
        this._connect(Main.layoutManager, 'monitors-changed', () => this._tryInitialPosition());
        this._connect(global.stage, 'motion-event', this._onMotion.bind(this));

        if (Main.messageTray) {
            this._connect(Main.messageTray, 'notify', () => {
                this._hideClock();
                this._overlay.opacity = ACTIVE_OPACITY;
                this._resetIdleTimer();
            });
        }

        if (Main.screenShield) {
            this._connect(Main.screenShield, 'hidden', () => {
                const timeoutId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    UNLOCK_DELAY_MS,
                    () => {
                        this._tryInitialPosition();
                        this._removeTimer(timeoutId);
                        return GLib.SOURCE_REMOVE;
                    }
                );
                this._timers.push(timeoutId);
            });
        }
    }

    _disconnectSignals() {
        if (this._signals) {
            this._signals.forEach(([obj, id]) => {
                try { obj.disconnect?.(id); } catch {}
            });
            this._signals = [];
        }
    }

    _connect(obj, sig, cb) {
        if (!this._signals) this._signals = [];
        this._signals.push([obj, obj.connect(sig, cb)]);
    }

    // === Timer/Clock ===
    _resetIdleTimer(delay = INACTIVITY_MS) {
        if (this._idleTimeout) {
            try { GLib.source_remove(this._idleTimeout); } catch {}
            this._timers = this._timers.filter(id => id !== this._idleTimeout);
            this._idleTimeout = 0;
        }

        const id = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            delay,
            () => {
                this._fadeIn();
                this._removeTimer(id);
                this._idleTimeout = 0;
                return GLib.SOURCE_REMOVE;
            }
        );
        this._idleTimeout = id;
        this._timers.push(id);
    }

    _armClockTick() {
        const now = Date.now();
        const msToNextMinute = 60000 - (now % 60000);

        const id1 = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            msToNextMinute,
            () => {
                this._updateClock();
                const id2 = GLib.timeout_add_seconds(
                    GLib.PRIORITY_DEFAULT,
                    60,
                    () => {
                        this._updateClock();
                        return GLib.SOURCE_CONTINUE;
                    }
                );
                this._timers.push(id2);
                this._removeTimer(id1);
                return GLib.SOURCE_REMOVE;
            }
        );
        this._timers.push(id1);
    }

    _updateClock() {
        if (!this._clock) return;
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        this._clock.text = `${hh}:${mm}`;
        this._positionClockWithJitter();
    }

    _positionClockWithJitter() {
        if (!this._clock || !this._overlay) return;

        const jitterX = Math.floor((Math.random() * 2 - 1) * CLOCK_JITTERX);
        const baseX = this._overlay.width - this._clock.width - CLOCK_MARGIN_RIGHT;

        const minX = 0;
        const maxX = Math.max(0, this._overlay.width - this._clock.width);
        const x = Math.min(maxX, Math.max(minX, baseX + jitterX));
        const y = Math.floor(this._overlay.height / 2 - this._clock.height / 2);

        this._clock.set_position(x, y);
    }

    _showClock() {
        this._updateClock();
        this._clock.show();
    }

    _hideClock() {
        this._clock.hide();
    }

    // Interactions
    _onMotion(_actor, event) {
        const [x, y] = event.get_coords();
        const [ox, oy, ow, oh] = this._rectOf(this._overlay);

        if (x >= ox && x <= ox + ow && y >= oy && y <= oy + oh) {
            this._hideClock();
            this._overlay.opacity = ACTIVE_OPACITY;
            this._resetIdleTimer();
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _fadeIn() {
        this._overlay.remove_all_transitions?.();
        this._overlay.ease({
            opacity: 255,
            duration: FADE_TIME_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this._showClock(),
        });
    }

    // Positioning
    _tryInitialPosition() {
        return this._repositionOverlay();
    }

    _rectOf(actor) {
        const [ax, ay] = actor.get_transformed_position();
        return [Math.round(ax), Math.round(ay), Math.round(actor.width), Math.round(actor.height)];
    }

    _repositionOverlay() {
        const panel = Main.panel;
        if (!panel) {
            return false;
        }

        const [x, y] = panel.get_transformed_position();
        const w = panel.width;
        const h = panel.height;

        this._overlay.set_position(x, y);
        this._overlay.set_size(w, h);
        this._positionClockWithJitter();
        return true;
    }

    // Helpers
    _removeTimer(id) {
        try { GLib.source_remove(id); } catch {}
        this._timers = this._timers.filter(x => x !== id);
    }
}

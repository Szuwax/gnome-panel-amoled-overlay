'use strict';

import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';


const INACTIVITY_MS    = 2000; //The delay with no mouse movement over the panel before the overlay appears(ms).
const FADE_TIME_MS     = 1000; // The duration of the overlay's fade-in animation(ms).
const INIT_DELAY_MS    = 6000;// The initial delay before positioning the overlay(ms).
const UNLOCK_DELAY_MS  = 6000; // The delay after unlocking the screen before repositioning the overlay(ms).
const INACTIVE_OPACITY = 0;    // The opacity of the transparent overlay(0-255). 0 = fully transparent
const INIT_RETRIES     = 3;    // The number of times to retry positioning the overlay if it fails.
const OVERLAY_COLOR    = '#000000';  // The background color of the overlay. Use #000000 for pure black (AMOLED display).

// Clock
const CLOCK_JITTERX      = 80;   //The maximum horizontal offset by which the clock can randomly shift left or right from its base position(px).
const CLOCK_MARGIN_RIGHT = 170;  // The fixed distance between the clock and the right edge of the overlay(px).

// Date
const DATE_MARGIN   = 6;      // Space between clock and date(px)
const DATE_US_STYLE = false;  //  false -DD.MM.YY, true -MM.DD.YY


export default class AMOLEDOverlayExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._overlay = null;
        this._clock = null;
        this._date = null;

        this._signals = [];
        this._timers = [];
        this._idleTimeout = 0;
        this._initTries = INIT_RETRIES;
    }

    enable() {
        this._overlay = new St.Widget({
            style: `background-color: ${OVERLAY_COLOR};`,
            reactive: false,
            opacity: INACTIVE_OPACITY,
        });

        this._clock = new St.Label({
            text: '',
            style_class: 'clock-label',
            visible: false,
        });
        this._overlay.add_child(this._clock);

        this._date = new St.Label({
            text: '',
            style_class: 'date-label',
            visible: false,
        });
        this._overlay.add_child(this._date);

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
        if (this._clock) {
            try { this._clock.destroy(); } catch {}
            this._clock = null;
        }
        if (this._date) {
            try { this._date.destroy(); } catch {}
            this._date = null;
        }

        if (this._overlay) {
            try { Main.layoutManager.removeChrome(this._overlay); } catch {}
            try { this._overlay.destroy(); } catch {}
            this._overlay = null;
        }
    }

    // Signals
    _connectSignals() {
        this._connect(global.stage, 'notify::allocation', () => this._tryInitialPosition());
        this._connect(Main.layoutManager, 'monitors-changed', () => this._tryInitialPosition());
        this._connect(global.stage, 'motion-event', this._onMotion.bind(this));

        if (Main.messageTray) {
            this._connect(Main.messageTray, 'notify', () => {
                this._hideClock();
                if (this._overlay) this._overlay.opacity = INACTIVE_OPACITY;
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

    // Timer
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
        if (!this._clock || !this._date || !this._overlay) return;
        if (!this._clock.get_parent?.() || !this._date.get_parent?.()) return;

        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        this._clock.text = `${hh}:${mm}`;

        const dd = String(now.getDate()).padStart(2, '0');
        const mmStr = String(now.getMonth() + 1).padStart(2, '0');
        const yy = String(now.getFullYear()).slice(-2);

        if (DATE_US_STYLE) {
            this._date.text = `${mmStr}.${dd}.${yy}`;
        } else {
            this._date.text = `${dd}.${mmStr}.${yy}`;
        }

        this._positionClockWithJitter();

        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._positionClockWithJitter();
            return GLib.SOURCE_REMOVE;
        });
    }

    _positionClockWithJitter() {
        if (!this._clock || !this._date || !this._overlay) return;
        if (!this._overlay.get_parent?.()) return;

        const jitterX = Math.floor((Math.random() * 2 - 1) * CLOCK_JITTERX);

        // Clock
        const baseClockX = this._overlay.width - this._clock.width - CLOCK_MARGIN_RIGHT;
        const minXClock = 0;
        const maxXClock = Math.max(0, this._overlay.width - this._clock.width);
        const clockX = Math.min(maxXClock, Math.max(minXClock, baseClockX + jitterX));
        const clockY = Math.floor(this._overlay.height / 2 - this._clock.height / 2);
        this._clock.set_position(clockX, clockY);

        // Date
        const dateX = clockX + this._clock.width + DATE_MARGIN;
        const dateY = Math.floor(this._overlay.height / 2 - this._date.height / 2);
        this._date.set_position(dateX, dateY);
    }

    _showClock() {
        this._updateClock();
        if (this._clock) this._clock.show();
        if (this._date) this._date.show();
    }

    _hideClock() {
        if (this._clock) this._clock.hide();
        if (this._date) this._date.hide();
    }

    // Interactions
    _onMotion(_actor, event) {
        if (!this._overlay) return Clutter.EVENT_PROPAGATE;

        const [x, y] = event.get_coords();
        const [ox, oy, ow, oh] = this._rectOf(this._overlay);

        if (x >= ox && x <= ox + ow && y >= oy && y <= oh) {
            this._hideClock();
            this._overlay.opacity = INACTIVE_OPACITY;
            this._resetIdleTimer();
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _fadeIn() {
        if (!this._overlay) return;
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
        if (!this._overlay) return false;

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

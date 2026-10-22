'use strict';

import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import UPowerGlib from 'gi://UPowerGlib';


// Settings
const INACTIVITY_MS    = 2000; // Delay with no mouse movement before overlay appears(ms)
const FADE_TIME_MS     = 1000; // Duration of fade-in animation(ms)
const INIT_DELAY_S     = 12;   // Initial delay before positioning overlay(sec)
const UNLOCK_DELAY_S   = 7;    // Delay after unlocking before repositioning overlay(sec)
const INACTIVE_OPACITY = 0;    // Fully transparent overlay opacity
const INIT_RETRIES     = 3;    // Retry count for repositioning overlay
const OVERLAY_COLOR    = '#000000'; // Overlay background color (pure black for AMOLED)

// Containers position
const LEFT_RATIO  = 0.25; // Left container position
const RIGHT_RATIO = 0.75; // Right container position

const B_JITTERX   = 180;  // Max horizontal offset for jump effect(px)

// Text spacing
const DATE_MARGIN = 6;    // Space between clock and date(px)
const USER_MARGIN = 6;    // Space between battery and username(px)

const SHOW_CLOCK    = true;
const SHOW_DATE     = true;
const SHOW_BATTERY  = true; // Battery info with charging status
const SHOW_USERNAME = true;

const REQUIRE_BUILTIN_ONLY = true;

const DEBUG = false;

// Duration of the smooth position-change animation for the containers
const POSITION_EASE_MS = 400;


function debugLog(msg) {
    if (DEBUG)
        log(`[AMOLEDOverlay] ${msg}`);
}

function safe(fn, context = "") {
    try {
        return fn();
    } catch (e) {
        if (DEBUG) {
            logError(e, `[AMOLEDOverlay] ${context}`);
        }
        return undefined;
    }
}

export default class AMOLEDOverlayExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._overlay = null;
        this._clock = null;
        this._date = null;
        this._container = null;

        this._leftContainer = null;
        this._batteryLabel = null;
        this._userLabel = null;

        this._upClient = null;
        this._batteryDevice = null;

        this._signals = [];

        this._timeouts = {
            idle: 0,
            clockTick: 0,
            initReposition: 0,
            unlockReposition: 0,
        };
        this._initTries = INIT_RETRIES;

        this._isVisible = false;
        this._isAnimating = false;

        this._active = false;
        this._monitorCheckSignalId = 0;
        this._positioned = false;

        this._dateFormatter = new Intl.DateTimeFormat(undefined, {
            year: '2-digit', //'numeric' for full year
            month: '2-digit',
            day: '2-digit'
        });
    }

    enable() {
        debugLog("enable()");
        this._monitorCheckSignalId = Main.layoutManager.connect(
            'monitors-changed',
            () => safe(() => this._checkMonitorConfig(), "monitor config check")
        );
        this._checkMonitorConfig();
    }

    disable() {
        debugLog("disable()");
        if (this._monitorCheckSignalId) {
            Main.layoutManager.disconnect(this._monitorCheckSignalId);
            this._monitorCheckSignalId = 0;
        }
        this._deactivate();
    }

    _checkMonitorConfig() {
        const supported = this._isBuiltinOnlyConfig();
        debugLog(`monitor config check: builtin-only=${supported}`);
        if (supported && !this._active) {
            this._activate();
        } else if (!supported && this._active) {
            this._deactivate();
        }
    }

    _isBuiltinOnlyConfig() {
        if (!REQUIRE_BUILTIN_ONLY)
            return true;
        try {
            const monitors = global.backend.get_monitor_manager().get_monitors();
            if (!monitors || monitors.length === 0)
                return false;
            return monitors.every(m => m.is_builtin());
        } catch (e) {
            debugLog(`monitor detection failed, assuming supported (${e.message})`);
            return true;
        }
    }

    _safeConnect(obj, sig, cb, ctx = "") {
        const id = obj.connect(sig, (...args) => {
            safe(() => cb(...args), ctx);
        });
        this._signals.push([obj, id]);
        return id;
    }

    _clearTimeout(key) {
        if (this._timeouts[key]) {
            GLib.source_remove(this._timeouts[key]);
            this._timeouts[key] = 0;
        }
    }

    _clearAllTimeouts() {
        Object.keys(this._timeouts).forEach(key => this._clearTimeout(key));
    }

    _activate() {
        if (this._active) return;
        debugLog("activate()");
        this._active = true;
        this._initTries = INIT_RETRIES;
        this._positioned = false;

        this._overlay = new St.Widget({
            style: `background-color: ${OVERLAY_COLOR};`,
            reactive: false,
            opacity: INACTIVE_OPACITY,
        });

        // Right container - time/date
        if (SHOW_CLOCK || SHOW_DATE) {
            this._container = new St.BoxLayout({
                style_class: 'amajac-clock-container',
                vertical: false,
                visible: false,
            });

            if (SHOW_CLOCK) {
                this._clock = this._makeLabel('', 'clock-label');
                this._container.add_child(this._clock);
            }

            if (SHOW_DATE) {
                this._date = this._makeLabel('', 'date-label');
                if (SHOW_CLOCK) {
                    this._date.set_style(`margin-left: ${DATE_MARGIN}px;`);
                }
                this._container.add_child(this._date);
            }

            this._overlay.add_child(this._container);
        }

        // Left container - battery/username
        if (SHOW_BATTERY || SHOW_USERNAME) {
            this._leftContainer = new St.BoxLayout({
                style_class: 'amajac-info-container',
                vertical: false,
                visible: false,
            });

            if (SHOW_BATTERY) {
                this._batteryLabel = this._makeLabel('', 'battery-label');
                this._leftContainer.add_child(this._batteryLabel);
                this._initBattery();
            }

            if (SHOW_USERNAME) {
                const username = GLib.get_user_name();
                this._userLabel = this._makeLabel(username, 'user-label');
                if (SHOW_BATTERY) {
                    this._userLabel.set_style(`margin-left: ${USER_MARGIN}px;`);
                }
                this._leftContainer.add_child(this._userLabel);
            }

            this._overlay.add_child(this._leftContainer);
        }

        try {
            Main.layoutManager.addTopChrome(this._overlay, {
                affectsInputRegion: false,
                trackFullscreen: true,
            });
        } catch (e) {
            debugLog(`addTopChrome: affectsInputRegion unsupported, retrying without it (${e.message})`);
            Main.layoutManager.addTopChrome(this._overlay, {
                trackFullscreen: true,
            });
        }

        this._armClockTick();
        this._connectSignals();
        this._initialTextUpdate();

        // First overlay repositioning/retry
        this._timeouts.initReposition = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, INIT_DELAY_S, () => {
            return safe(() => {
                debugLog("initial reposition attempt");
                const ok = this._repositionOverlay();
                if (ok) {
                    this._initialTextUpdate();
                    this._resetIdleTimer();
                    this._timeouts.initReposition = 0;
                    return GLib.SOURCE_REMOVE;
                }
                if (--this._initTries > 0) {
                    return GLib.SOURCE_CONTINUE;
                }
                this._timeouts.initReposition = 0;
                return GLib.SOURCE_REMOVE;
            }, "reposition failed");
        });
    }

    _deactivate() {
        if (!this._active && !this._overlay) return;
        debugLog("deactivate()");
        this._active = false;

        this._clearAllTimeouts();
        this._disconnectSignals();
        this._batteryDevice = null;
        if (this._upClient) {
            this._upClient.run_dispose?.();
            this._upClient = null;
        }

        this._container = null;
        this._clock = null;
        this._date = null;
        this._leftContainer = null;
        this._batteryLabel = null;
        this._userLabel = null;

        if (this._overlay) {
            Main.layoutManager.removeChrome(this._overlay);
            this._overlay.destroy();
            this._overlay = null;
        }
        this._isVisible = false;
        this._isAnimating = false;
        this._positioned = false;
    }

    _makeLabel(text, styleClass = 'clock-label') {
        return new St.Label({
            text,
            style_class: styleClass,
            y_align: Clutter.ActorAlign.CENTER,
        });
    }

    // Battery init
    _initBattery() {
        safe(() => {
            this._upClient = UPowerGlib.Client.new();
            const devices = this._upClient.get_devices();
            this._batteryDevice = devices.find(d => d.kind === UPowerGlib.DeviceKind.BATTERY);

            if (this._batteryDevice) {
                this._safeConnect(this._batteryDevice, 'notify::percentage',
                    () => this._updateBatteryLabel(), "battery update error");
                this._safeConnect(this._batteryDevice, 'notify::state',
                    () => this._updateBatteryLabel(), "battery state update error");
                this._updateBatteryLabel();
            }
        }, "battery init error");

        if (!this._batteryDevice && this._batteryLabel) {
            this._batteryLabel.text = "??%";
        }
    }

    // Battery label update
    _updateBatteryLabel() {
        if (this._batteryLabel && this._batteryDevice) {
            const percent = Math.round(this._batteryDevice.percentage);
            const charging = this._batteryDevice.state === UPowerGlib.DeviceState.CHARGING;
            this._batteryLabel.text = `${charging ? "C" : ""}${percent}%`;
            debugLog(`battery ${this._batteryLabel.text}`);
        }
    }

    // Initial content update
    _initialTextUpdate() {
        this._updateClock();
        this._updateBatteryLabel();
    }

    // Signals
    _connectSignals() {
        this._safeConnect(global.stage, 'notify::allocation', () => this._repositionOverlay(), "stage allocation");
        this._safeConnect(Main.layoutManager, 'monitors-changed', () => this._repositionOverlay(), "monitors changed");
        this._safeConnect(Main.panel, 'enter-event', () => {
            this._hideOverlay();
            this._resetIdleTimer();
        }, "panel enter");
        if (Main.messageTray) {
            this._safeConnect(Main.messageTray, 'notify', () => {
                this._hideOverlay();
                this._resetIdleTimer();
            }, "messageTray notify");
        }
        if (Main.screenShield) {
            this._safeConnect(Main.screenShield, 'hidden', () => {
                this._clearTimeout('unlockReposition');
                this._timeouts.unlockReposition = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, UNLOCK_DELAY_S, () => {
                    return safe(() => {
                        this._repositionOverlay();
                        this._timeouts.unlockReposition = 0;
                        return GLib.SOURCE_REMOVE;
                    }, "unlock reposition error");
                });
            }, "screenShield hidden");
        }
    }

    _disconnectSignals() {
        this._signals.forEach(([obj, id]) => {
            safe(() => obj.disconnect(id), "disconnect error");
        });
        this._signals = [];
    }

    // Idle timer
    _resetIdleTimer(delay = INACTIVITY_MS) {
        this._clearTimeout('idle');
        this._timeouts.idle = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            safe(() => {
                this._fadeIn();
            }, "idle timer error");
            this._timeouts.idle = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    // Time scheduling
    _armClockTick() {
        const now = Date.now();
        const msToNextMinute = 60000 - (now % 60000);
        this._timeouts.clockTick = GLib.timeout_add(GLib.PRIORITY_DEFAULT, msToNextMinute, () => {
            this._timeouts.clockTick = 0;
            safe(() => this._updateClock(), "first tick error");
            this._timeouts.clockTick = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                60,
                () => {
                    safe(() => this._updateClock(), "clock tick error");
                    return GLib.SOURCE_CONTINUE;
                }
            );
            return GLib.SOURCE_REMOVE;
        });
    }

    // Update time / reposition containers
    _updateClock() {
        if (!this._clock && !this._date) return;
        const now = new Date();
        if (this._clock) {
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');
            this._clock.text = `${hh}:${mm}`;
        }
        if (this._date) {
            this._date.text = this._dateFormatter.format(now);
        }
        this._positionContainer(this._container, RIGHT_RATIO);
        this._positionContainer(this._leftContainer, LEFT_RATIO);
        this._avoidOverlap();
    }

    // Container positioning
    _computeJitteredX(baseX, containerWidth) {
        const jitterX = Math.floor((Math.random() * 2 - 1) * B_JITTERX);
        const minX = 0;
        const maxX = Math.max(0, this._overlay.width - containerWidth);
        return Math.min(maxX, Math.max(minX, baseX + jitterX));
    }

    // ratio: container center position as a fraction of overlay width
    // (RIGHT_RATIO for the clock, LEFT_RATIO for battery/username)
    _positionContainer(container, ratio) {
        if (!container || !this._overlay?.get_parent?.()) return;
        const baseX = Math.floor(this._overlay.width * ratio - container.width / 2);
        const containerX = this._computeJitteredX(baseX, container.width);
        const containerY = Math.floor(this._overlay.height / 2 - container.height / 2);

        if (this._isVisible) {
            container.remove_all_transitions?.();
            container.ease({
                x: containerX,
                y: containerY,
                duration: POSITION_EASE_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            container.set_position(containerX, containerY);
        }
    }

    // Prevent overlapping
    _avoidOverlap() {
        if (this._container && this._leftContainer) {
            const rightX = this._container.x;
            const leftX = this._leftContainer.x + this._leftContainer.width;
            if (leftX > rightX) {
                this._positionContainer(this._container, RIGHT_RATIO);
                this._positionContainer(this._leftContainer, LEFT_RATIO);
            }
        }
    }

    // Animation
    _fadeIn() {
        if (!this._overlay || !this._positioned) return;
        if (this._isAnimating || this._isVisible) return;

        debugLog("fadeIn start");
        this._isAnimating = true;
        this._overlay.remove_all_transitions?.();
        this._overlay.ease({
            opacity: 255,
            duration: FADE_TIME_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                safe(() => {
                    if (!this._overlay) return;
                    this._isAnimating = false;
                    this._isVisible = true;
                    this._initialTextUpdate();
                    this._showContainers();
                    debugLog("fadeIn complete");
                }, "fadeIn error");
            },
        });
    }

    // Hide overlay instantly
    _hideOverlay() {
        if (!this._overlay) return;
        if (!this._isVisible && !this._isAnimating) return;
        this._overlay.remove_all_transitions?.();
        this._overlay.opacity = INACTIVE_OPACITY;
        this._hideContainers();
        this._isVisible = false;
        this._isAnimating = false;
    }

    _showContainers() {
        if (this._container) this._container.show();
        if (this._leftContainer) this._leftContainer.show();
    }

    _hideContainers() {
        if (this._container) this._container.hide();
        if (this._leftContainer) this._leftContainer.hide();
    }

    // Reposition overlay
    _repositionOverlay() {
        if (!this._overlay) return false;
        const panel = Main.panel;
        if (!panel) return false;
        const [x, y] = panel.get_transformed_position();
        const w = panel.width;
        const h = panel.height;

        if (w === 0 || h === 0) {
            return false;
        }

        this._overlay.set_position(x, y);
        this._overlay.set_size(w, h);
        this._positionContainer(this._container, RIGHT_RATIO);
        this._positionContainer(this._leftContainer, LEFT_RATIO);
        this._avoidOverlap();
        this._positioned = true;
        debugLog(`reposition overlay ${w}x${h} at ${x},${y}`);
        return true;
    }
}

'use strict';

import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import UPowerGlib from 'gi://UPowerGlib';

const INACTIVITY_MS    = 2000; //Delay with no mouse movement over the panel before the overlay appears(ms)
const FADE_TIME_MS     = 1000; // Duration of the overlay's fade-in animation(ms)
const INIT_DELAY_S     = 6;    // Initial delay before positioning the overlay(sec)
const UNLOCK_DELAY_S   = 6;    // Delay after unlocking the screen before repositioning the overlay(sec)
const INACTIVE_OPACITY = 0;    // Opacity of the transparent overlay (0–255). 0 = fully transparent
const INIT_RETRIES     = 3;    // Number of times to retry positioning the overlay if it fails
const OVERLAY_COLOR    = '#000000'; // Background color of the overlay. Use #000000 for pure black (AMOLED display).

const B_JITTERX        = 180;  // The maximum horizontal offset by which the container can randomly shift left or right from its base position(px).

const DATE_MARGIN      = 6;    //Space between clock and date(px)
const USER_MARGIN      = 6;    // Space between battery and username(px)

const SHOW_CLOCK       = true;
const SHOW_DATE        = true;
const SHOW_BATTERY     = true; //Battery info with charging status
const SHOW_USERNAME    = true;

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
        this._batterySignal = null;

        this._signals = [];
        this._idleTimeout = 0;
        this._clockTickId = 0;
        this._initTries = INIT_RETRIES;

        this._isVisible = false;
        this._isAnimating = false;

        this._dateFormatter = new Intl.DateTimeFormat(undefined, {
            year: '2-digit',
            month: '2-digit',
            day: '2-digit'
        });
    }

    enable() {
        this._overlay = new St.Widget({
            style: `background-color: ${OVERLAY_COLOR};`,
            reactive: false,
            opacity: INACTIVE_OPACITY,
        });

        // Right container
        if (SHOW_CLOCK || SHOW_DATE) {
            this._container = new St.BoxLayout({
                style_class: 'amajac-clock-container',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                vertical: false,
                visible: false,
            });

            if (SHOW_CLOCK) {
                this._clock = new St.Label({
                    text: '',
                    style_class: 'clock-label',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._container.add_child(this._clock);
            }

            if (SHOW_DATE) {
                this._date = new St.Label({
                    text: '',
                    style_class: 'date-label',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                if (SHOW_CLOCK) {
                    this._date.set_style(`margin-left: ${DATE_MARGIN}px;`);
                }
                this._container.add_child(this._date);
            }

            this._overlay.add_child(this._container);
        }

        // Left container
        if (SHOW_BATTERY || SHOW_USERNAME) {
            this._leftContainer = new St.BoxLayout({
                style_class: 'amajac-info-container',
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.CENTER,
                vertical: false,
                visible: false,
            });

            if (SHOW_BATTERY) {
                this._batteryLabel = new St.Label({
                    text: '',
                    style_class: 'clock-label',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._leftContainer.add_child(this._batteryLabel);
                this._initBattery();
            }

            if (SHOW_USERNAME) {
                const username = GLib.get_user_name();
                this._userLabel = new St.Label({
                    text: username,
                    style_class: 'clock-label',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                if (SHOW_BATTERY) {
                    this._userLabel.set_style(`margin-left: ${USER_MARGIN}px;`);
                }
                this._leftContainer.add_child(this._userLabel);
            }

            this._overlay.add_child(this._leftContainer);
        }

        Main.layoutManager.addTopChrome(this._overlay, {
            affectsInputRegion: false,
            trackFullscreen: true,
        });

        this._armClockTick();
        this._connectSignals();

        // Initial positioning & text
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, INIT_DELAY_S, () => {
            const ok = this._repositionOverlay();
            if (ok) {
                this._resetIdleTimer();
                this._initialTextUpdate();
                return GLib.SOURCE_REMOVE;
            }
            if (--this._initTries > 0) {
                return GLib.SOURCE_CONTINUE;
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {
        if (this._idleTimeout) {
            GLib.source_remove(this._idleTimeout);
            this._idleTimeout = 0;
        }

        if (this._clockTickId) {
            GLib.source_remove(this._clockTickId);
            this._clockTickId = 0;
        }

        this._disconnectSignals();

        if (this._batteryDevice && this._batterySignal) {
            this._batteryDevice.disconnect(this._batterySignal);
            this._batterySignal = null;
        }
        this._batteryDevice = null;

        if (this._upClient) {
            this._upClient.run_dispose?.();
            this._upClient = null;
        }

        if (this._container) {
            this._container.destroy();
            this._container = null;
            this._clock = null;
            this._date = null;
        }

        if (this._leftContainer) {
            this._leftContainer.destroy();
            this._leftContainer = null;
            this._batteryLabel = null;
            this._userLabel = null;
        }

        if (this._overlay) {
            Main.layoutManager.removeChrome(this._overlay);
            this._overlay.destroy();
            this._overlay = null;
        }

        this._isVisible = false;
        this._isAnimating = false;
    }

    // Battery
    _initBattery() {
        try {
            this._upClient = UPowerGlib.Client.new();
            const devices = this._upClient.get_devices();
            this._batteryDevice = devices.find(d => d.kind === UPowerGlib.DeviceKind.BATTERY);

            if (this._batteryDevice) {
                this._batterySignal = this._batteryDevice.connect('notify::percentage', () => {
                    this._updateBatteryLabel();
                });
                this._updateBatteryLabel();
            }
        } catch (e) {
            logError(e);
            if (this._batteryLabel) this._batteryLabel.text = "??%";
        }
    }

    _updateBatteryLabel() {
        if (this._batteryLabel && this._batteryDevice) {
            const percent = Math.round(this._batteryDevice.percentage);
            const charging = this._batteryDevice.state === UPowerGlib.DeviceState.CHARGING;
            this._batteryLabel.text = `${charging ? "C" : ""}${percent}%`;
        }
    }

    _initialTextUpdate() {
        this._updateClock();
        this._updateBatteryLabel();
    }

    // Signals
    _connectSignals() {
        this._signals.push([global.stage, global.stage.connect('notify::allocation', () => this._repositionOverlay())]);
        this._signals.push([Main.layoutManager, Main.layoutManager.connect('monitors-changed', () => this._repositionOverlay())]);

        this._signals.push([Main.panel, Main.panel.connect('enter-event', () => {
            this._hideOverlay();
            this._resetIdleTimer();
        })]);

        if (Main.messageTray) {
            this._signals.push([Main.messageTray, Main.messageTray.connect('notify', () => {
                this._hideOverlay();
                this._resetIdleTimer();
            })]);
        }

        if (Main.screenShield) {
            this._signals.push([Main.screenShield, Main.screenShield.connect('hidden', () => {
                GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, UNLOCK_DELAY_S, () => {
                    this._repositionOverlay();
                    return GLib.SOURCE_REMOVE;
                });
            })]);
        }
    }

    _disconnectSignals() {
        this._signals.forEach(([obj, id]) => {
            try {
                obj.disconnect(id);
            } catch (e) {
                logError(e);
            }
        });
        this._signals = [];
    }

    // Idle timer
    _resetIdleTimer(delay = INACTIVITY_MS) {
        if (this._idleTimeout) {
            GLib.source_remove(this._idleTimeout);
            this._idleTimeout = 0;
        }

        if (delay % 1000 === 0) {
            this._idleTimeout = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                delay / 1000,
                () => {
                    this._fadeIn();
                    this._idleTimeout = 0;
                    return GLib.SOURCE_REMOVE;
                }
            );
        } else {
            this._idleTimeout = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                delay,
                () => {
                    this._fadeIn();
                    this._idleTimeout = 0;
                    return GLib.SOURCE_REMOVE;
                }
            );
        }
    }

    // Clock tick
    _armClockTick() {
        const now = Date.now();
        const msToNextMinute = 60000 - (now % 60000);

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, msToNextMinute, () => {
            this._updateUI();
            this._clockTickId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                60,
                () => {
                    this._updateUI();
                    return GLib.SOURCE_CONTINUE;
                }
            );
            return GLib.SOURCE_REMOVE;
        });
    }

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

        this._positionContainer(this._container, "right");
        this._positionContainer(this._leftContainer, "left");
        this._avoidOverlap();
    }

    _updateUI() {
        this._updateClock();
        this._updateBatteryLabel();
    }

    // Positioning
    _computeJitteredX(baseX, containerWidth) {
        let jitterX = Math.floor((Math.random() * 2 - 1) * B_JITTERX);
        const minX = 0;
        const maxX = Math.max(0, this._overlay.width - containerWidth);
        return Math.min(maxX, Math.max(minX, baseX + jitterX));
    }

    _positionContainer(container, side) {
        if (!container || !this._overlay?.get_parent?.()) return;

        const containerWidth = container.width;
        const overlayWidth = this._overlay.width;

        let baseX;
        if (side === "right") {
            baseX = Math.floor(overlayWidth * 0.75 - containerWidth / 2);
        } else {
            baseX = Math.floor(overlayWidth * 0.25 - containerWidth / 2);
        }

        const containerX = this._computeJitteredX(baseX, containerWidth);
        const containerY = Math.floor(this._overlay.height / 2 - container.height / 2);
        container.set_position(containerX, containerY);
    }

    _avoidOverlap() {
        if (this._container && this._leftContainer) {
            const rightX = this._container.x;
            const leftX = this._leftContainer.x + this._leftContainer.width;
            if (leftX > rightX) {
                this._positionContainer(this._container, "right");
                this._positionContainer(this._leftContainer, "left");
            }
        }
    }

    _fadeIn() {
        if (!this._overlay) return;
        if (this._isAnimating || this._isVisible) return;

        this._isAnimating = true;

        this._overlay.remove_all_transitions?.();
        this._overlay.ease({
            opacity: 255,
            duration: FADE_TIME_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (!this._overlay) return;
                this._isAnimating = false;
                this._isVisible = true;
                this._updateUI();
                this._showContainers();
            },
        });
    }

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

    _repositionOverlay() {
        if (!this._overlay) return false;

        const panel = Main.panel;
        if (!panel) return false;

        const [x, y] = panel.get_transformed_position();
        const w = panel.width;
        const h = panel.height;

        this._overlay.set_position(x, y);
        this._overlay.set_size(w, h);

        this._positionContainer(this._container, "right");
        this._positionContainer(this._leftContainer, "left");
        this._avoidOverlap();
        return true;
    }
}

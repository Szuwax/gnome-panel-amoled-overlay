import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import UPowerGlib from 'gi://UPowerGlib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';


// Settings
const INACTIVITY_MS    = 2000; // Delay with no mouse movement before overlay appears(ms)
const FADE_TIME_MS     = 1000; // Duration of fade-in animation(ms)
const FADE_OUT_MS      = 150;  // Duration of fade-out animation(ms)
const INIT_DELAY_S     = 12;   // Initial delay before positioning overlay(sec)
const INACTIVE_OPACITY = 0;    // Fully transparent overlay opacity
const INIT_RETRIES     = 3;    // Retry count for repositioning overlay
const OVERLAY_COLOR    = '#000000'; // Overlay background color (pure black for AMOLED)

// Containers position
const LEFT_RATIO  = 0.25; // Left container position
const RIGHT_RATIO = 0.75; // Right container position

const B_JITTERX   = 180;  // Max horizontal offset for jump effect(px)
const MIN_GAP     = 12;   // Min space kept between left and right container(px)

// Text spacing
const DATE_MARGIN = 12;    // Space between clock and date(px)
const INFO_MARGIN = 12;    // Space between battery and the LEFT_INFO label(px)

const SHOW_CLOCK    = true;
const SHOW_DATE     = true;
const SHOW_BATTERY  = 'auto'; // Battery info with charging status: true | false | 'auto' (only when unplugged)

// Second label next to the battery:
//  'user'      - username
//  'time'      - battery time remaining (to empty, or to full while charging)
//  'workspace' - active workspace number / workspace count
//  'none'      - nothing
const LEFT_INFO = 'none';

const LOW_BATTERY_PERCENT = 15; // At or below this the battery label gets the low-battery style

const REQUIRE_BUILTIN_ONLY = true;

const DEBUG = false;

// Duration of the smooth position-change animation for the containers
const POSITION_EASE_MS = 400;

// Style classes (see stylesheet.css)
const CLASS_CLOCK   = 'amoled-overlay-clock';
const CLASS_DATE    = 'amoled-overlay-date';
const CLASS_BATTERY = 'amoled-overlay-battery';
const CLASS_BATTERY_LOW = 'amoled-overlay-battery-low';
const CLASS_INFO    = 'amoled-overlay-info';


function debugLog(msg) {
    if (DEBUG)
        console.log(`[AMOLEDOverlay] ${msg}`);
}

function safe(fn, context = '') {
    try {
        return fn();
    } catch (e) {
        console.error(`[AMOLEDOverlay] ${context}:`, e);
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
        this._infoLabel = null;

        this._upClient = null;
        this._batteryDevice = null;
        this._dateFormatter = null;
        this._motionController = null;

        this._signals = [];

        this._timeouts = {
            idle: 0,
            clockTick: 0,
            initReposition: 0,
        };
        this._initTries = INIT_RETRIES;

        this._isVisible = false;
        this._isAnimating = false;

        this._active = false;
        this._monitorCheckSignalId = 0;
        this._positioned = false;
    }

    enable() {
        debugLog('enable()');
        this._monitorCheckSignalId = Main.layoutManager.connect(
            'monitors-changed',
            () => safe(() => this._checkMonitorConfig(), 'monitor config check')
        );
        this._checkMonitorConfig();
    }

    disable() {
        debugLog('disable()');
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
            try {
                this._activate();
            } catch (e) {
                safe(() => this._deactivate(), 'cleanup after failed activate');
                throw e;
            }
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

    _safeConnect(obj, sig, cb, ctx = '') {
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
        debugLog('activate()');
        this._active = true;
        this._initTries = INIT_RETRIES;
        this._positioned = false;

        this._dateFormatter = new Intl.DateTimeFormat(undefined, {
            year: '2-digit', // 'numeric' for full year
            month: '2-digit',
            day: '2-digit',
        });

        this._overlay = new St.Widget({
            style: `background-color: ${OVERLAY_COLOR};`,
            reactive: false,
            opacity: INACTIVE_OPACITY,
        });

        // Right container - time/date
        if (SHOW_CLOCK || SHOW_DATE) {
            this._container = new St.BoxLayout({ visible: false });

            if (SHOW_CLOCK) {
                this._clock = this._makeLabel('', CLASS_CLOCK);
                this._container.add_child(this._clock);
            }

            if (SHOW_DATE) {
                this._date = this._makeLabel('', CLASS_DATE);
                if (SHOW_CLOCK)
                    this._date.set_style(`margin-left: ${DATE_MARGIN}px;`);
                this._container.add_child(this._date);
            }

            this._overlay.add_child(this._container);
        }

        // Left container - battery/info
        const showInfo = ['user', 'time', 'workspace'].includes(LEFT_INFO);
        if (SHOW_BATTERY || showInfo) {
            this._leftContainer = new St.BoxLayout({ visible: false });

            if (SHOW_BATTERY) {
                this._batteryLabel = this._makeLabel('', CLASS_BATTERY);
                this._leftContainer.add_child(this._batteryLabel);
            }

            if (showInfo) {
                this._infoLabel = this._makeLabel('', CLASS_INFO);
                this._leftContainer.add_child(this._infoLabel);
            }

            if (SHOW_BATTERY || LEFT_INFO === 'time')
                this._initBattery();
            this._updateBatteryVisibility();

            this._overlay.add_child(this._leftContainer);
        }

        try {
            Main.layoutManager.addTopChrome(this._overlay, {
                affectsInputRegion: false,
                trackFullscreen: true,
            });
        } catch (e) {
            debugLog(`addTopChrome: retrying without affectsInputRegion (${e.message})`);
            Main.layoutManager.addTopChrome(this._overlay, {
                trackFullscreen: true,
            });
        }

        this._armClockTick();
        this._connectSignals();
        this._updateTexts();

        // First overlay repositioning/retry
        this._timeouts.initReposition = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, INIT_DELAY_S, () => {
            debugLog('initial reposition attempt');
            const ok = safe(() => this._repositionOverlay(), 'initial reposition');
            if (ok) {
                this._resetIdleTimer();
            } else if (--this._initTries > 0) {
                return GLib.SOURCE_CONTINUE;
            }
            this._timeouts.initReposition = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    _deactivate() {
        if (!this._active && !this._overlay) return;
        debugLog('deactivate()');
        this._active = false;

        this._clearAllTimeouts();
        this._disconnectSignals();
        this._batteryDevice = null;
        this._upClient = null;
        this._dateFormatter = null;

        this._container = null;
        this._clock = null;
        this._date = null;
        this._leftContainer = null;
        this._batteryLabel = null;
        this._infoLabel = null;

        this._isVisible = false;
        this._isAnimating = false;
        this._positioned = false;

        if (this._overlay) {
            this._overlay.remove_all_transitions();
            Main.layoutManager.removeChrome(this._overlay);
            this._overlay.destroy();
            this._overlay = null;
        }
    }

    _makeLabel(text, styleClass) {
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
            this._batteryDevice = devices.find(d =>
                d.kind === UPowerGlib.DeviceKind.BATTERY && d.power_supply) ?? null;

            if (this._batteryDevice) {
                this._safeConnect(this._batteryDevice, 'notify::percentage',
                    () => this._updateBatteryLabel(), 'battery update error');
                this._safeConnect(this._batteryDevice, 'notify::state',
                    () => this._updateBatteryLabel(), 'battery state update error');
                if (LEFT_INFO === 'time') {
                    this._safeConnect(this._batteryDevice, 'notify::time-to-empty',
                        () => this._updateInfoLabel(), 'battery time update error');
                    this._safeConnect(this._batteryDevice, 'notify::time-to-full',
                        () => this._updateInfoLabel(), 'battery time update error');
                }
                this._updateBatteryLabel();
            }
            if (SHOW_BATTERY === 'auto') {
                this._safeConnect(this._upClient, 'notify::on-battery',
                    () => this._updateBatteryVisibility(), 'on-battery update error');
            }
        }, 'battery init error');

        if (!this._batteryDevice && this._batteryLabel)
            this._batteryLabel.text = '??%';
    }

    // Show/hide the battery part (SHOW_BATTERY = 'auto': visible only when unplugged)
    _updateBatteryVisibility() {
        const hidden = SHOW_BATTERY === 'auto' && !this._upClient?.on_battery;
        if (this._batteryLabel)
            this._batteryLabel.visible = !hidden;
        if (this._infoLabel) {
            if (LEFT_INFO === 'time')
                this._infoLabel.visible = !hidden;
            this._infoLabel.set_style(this._batteryLabel && !hidden
                ? `margin-left: ${INFO_MARGIN}px;` : null);
        }
        this._layoutContainers(this._isVisible);
    }

    // Battery label update
    _updateBatteryLabel() {
        if (this._batteryLabel && this._batteryDevice) {
            const percent = Math.round(this._batteryDevice.percentage);
            const charging = this._batteryDevice.state === UPowerGlib.DeviceState.CHARGING;
            this._batteryLabel.text = `${charging ? 'C' : ''}${percent}%`;
            if (!charging && percent <= LOW_BATTERY_PERCENT)
                this._batteryLabel.add_style_class_name(CLASS_BATTERY_LOW);
            else
                this._batteryLabel.remove_style_class_name(CLASS_BATTERY_LOW);
            debugLog(`battery ${this._batteryLabel.text}`);
        }
        if (LEFT_INFO === 'time')
            this._updateInfoLabel();
    }

    // Info label update (LEFT_INFO)
    _updateInfoLabel() {
        if (!this._infoLabel) return;
        let text = '';
        if (LEFT_INFO === 'user') {
            text = GLib.get_user_name();
        } else if (LEFT_INFO === 'time' && this._batteryDevice) {
            const charging = this._batteryDevice.state === UPowerGlib.DeviceState.CHARGING;
            const seconds = charging
                ? this._batteryDevice.time_to_full
                : this._batteryDevice.time_to_empty;
            if (seconds > 0) {
                const minutes = Math.round(seconds / 60);
                text = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
            }
        } else if (LEFT_INFO === 'workspace') {
            const manager = global.workspace_manager;
            text = `${manager.get_active_workspace_index() + 1}/${manager.get_n_workspaces()}`;
        }
        this._infoLabel.text = text;
    }

    // Signals
    _connectSignals() {
        this._safeConnect(global.stage, 'notify::allocation', () => this._repositionOverlay(), 'stage allocation');
        this._safeConnect(Main.layoutManager, 'monitors-changed', () => this._repositionOverlay(), 'monitors changed');
        if (LEFT_INFO === 'workspace') {
            this._safeConnect(global.workspace_manager, 'active-workspace-changed',
                () => this._updateInfoLabel(), 'workspace changed');
            this._safeConnect(global.workspace_manager, 'notify::n-workspaces',
                () => this._updateInfoLabel(), 'workspace count changed');
        }
        this._safeConnect(Main.overview, 'showing', () => {
            this._hideOverlay();
            this._resetIdleTimer();
        }, 'overview showing');
        const onPanelEnter = () => {
            this._hideOverlay();
            this._resetIdleTimer();
        };
        const onPanelLeave = () => this._resetIdleTimer();
        if (Clutter.MotionController) {
            this._motionController = new Clutter.MotionController();
            this._safeConnect(this._motionController, 'enter', onPanelEnter, 'panel enter');
            safe(() => this._safeConnect(this._motionController, 'leave', onPanelLeave, 'panel leave'),
                'connect panel leave');
            Main.panel.add_action(this._motionController);
        } else {
            this._safeConnect(Main.panel, 'enter-event', onPanelEnter, 'panel enter');
            this._safeConnect(Main.panel, 'leave-event', onPanelLeave, 'panel leave');
        }

        if (Main.messageTray) {
            const onNotification = () => {
                this._hideOverlay();
                this._resetIdleTimer();
            };
            try {
                this._safeConnect(Main.messageTray, 'queue-changed', onNotification, 'messageTray queue-changed');
            } catch (e) {
                debugLog(`queue-changed unavailable, falling back to notify (${e.message})`);
                this._safeConnect(Main.messageTray, 'notify', onNotification, 'messageTray notify');
            }
        }
    }

    _disconnectSignals() {
        this._signals.forEach(([obj, id]) => {
            safe(() => obj.disconnect(id), 'disconnect error');
        });
        this._signals = [];

        if (this._motionController) {
            const controller = this._motionController;
            safe(() => controller.get_actor()?.remove_action(controller), 'remove motion controller');
            this._motionController = null;
        }
    }

    // True while the overview is open, a panel menu is open or the pointer is on the panel
    _panelInUse() {
        if (Main.overview.visible || Main.panel.menuManager?.activeMenu)
            return true;
        if (!this._overlay) return false;
        const [px, py] = global.get_pointer();
        const { x, y, width, height } = this._overlay;
        return px >= x && px < x + width && py >= y && py < y + height;
    }

    // Idle timer
    _resetIdleTimer(delay = INACTIVITY_MS) {
        this._clearTimeout('idle');
        this._timeouts.idle = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._timeouts.idle = 0;
            safe(() => {
                if (this._panelInUse()) {
                    debugLog(`idle: panel in use (menu=${!!Main.panel.menuManager?.activeMenu}, pointer=${global.get_pointer().slice(0, 2)}), waiting`);
                    this._resetIdleTimer();
                } else {
                    debugLog(`idle: fading in (positioned=${this._positioned})`);
                    this._fadeIn();
                }
            }, 'idle timer error');
            return GLib.SOURCE_REMOVE;
        });
    }

    // Schedule the next clock update on the minute boundary
    _armClockTick() {
        this._clearTimeout('clockTick');
        const msToNextMinute = 60000 - (Date.now() % 60000) + 20;
        this._timeouts.clockTick = GLib.timeout_add(GLib.PRIORITY_DEFAULT, msToNextMinute, () => {
            this._timeouts.clockTick = 0;
            safe(() => this._updateClock(), 'clock tick error');
            this._armClockTick();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Refresh all texts without moving anything
    _updateTexts() {
        const now = new Date();
        if (this._clock) {
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');
            this._clock.text = `${hh}:${mm}`;
        }
        if (this._date && this._dateFormatter)
            this._date.text = this._dateFormatter.format(now);
        this._updateBatteryLabel();
        this._updateInfoLabel();
    }

    // Minute tick: update time and jump to a new position
    _updateClock() {
        this._updateTexts();
        this._layoutContainers(this._isVisible);
    }

    // Container positioning
    _naturalSize(container) {
        const [, width] = container.get_preferred_width(-1);
        const [, height] = container.get_preferred_height(-1);
        return [width, height];
    }

    // ratio: container center position as a fraction of overlay width
    _computeX(ratio, width, jitter) {
        const offset = jitter ? Math.floor((Math.random() * 2 - 1) * B_JITTERX) : 0;
        const baseX = Math.floor(this._overlay.width * ratio - width / 2);
        const maxX = Math.max(0, this._overlay.width - width);
        return Math.min(maxX, Math.max(0, baseX + offset));
    }

    _placeContainer(container, x, height, animate) {
        const y = Math.floor(this._overlay.height / 2 - height / 2);
        container.remove_all_transitions();
        if (animate) {
            container.ease({
                x,
                y,
                duration: POSITION_EASE_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            container.set_position(x, y);
        }
    }

    // Pick new jittered positions for both containers
    _layoutContainers(animate = false) {
        if (!this._overlay?.get_parent() || this._overlay.width <= 0) return;

        const left = this._leftContainer;
        const right = this._container;
        const [leftW, leftH] = left ? this._naturalSize(left) : [0, 0];
        const [rightW, rightH] = right ? this._naturalSize(right) : [0, 0];

        let leftX = left ? this._computeX(LEFT_RATIO, leftW, true) : 0;
        let rightX = right ? this._computeX(RIGHT_RATIO, rightW, true) : 0;

        if (left && right && leftX + leftW + MIN_GAP > rightX) {
            leftX = this._computeX(LEFT_RATIO, leftW, false);
            rightX = this._computeX(RIGHT_RATIO, rightW, false);
        }

        if (left) this._placeContainer(left, leftX, leftH, animate);
        if (right) this._placeContainer(right, rightX, rightH, animate);
    }

    // Animation
    _fadeIn() {
        if (!this._overlay || !this._positioned) return;
        if (this._isAnimating || this._isVisible) return;

        debugLog('fadeIn start');
        this._isAnimating = true;
        this._overlay.remove_all_transitions();
        this._overlay.ease({
            opacity: 255,
            duration: FADE_TIME_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: finished => {
                safe(() => {
                    if (!this._overlay || !this._isAnimating) return;
                    this._isAnimating = false;

                    if (!finished) {
                        this._overlay.opacity = INACTIVE_OPACITY;
                        this._resetIdleTimer();
                        debugLog('fadeIn interrupted');
                        return;
                    }

                    this._isVisible = true;
                    this._updateTexts();
                    this._showContainers();
                    this._layoutContainers(false);
                    debugLog('fadeIn complete');
                }, 'fadeIn error');
            },
        });
    }

    // Hide overlay with a short fade-out
    _hideOverlay() {
        if (!this._overlay) return;
        if (!this._isVisible && !this._isAnimating) return;
        this._isVisible = false;
        this._isAnimating = false;
        this._hideContainers();
        this._overlay.remove_all_transitions();
        this._overlay.ease({
            opacity: INACTIVE_OPACITY,
            duration: FADE_OUT_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: () => {
                if (this._overlay && !this._isAnimating && !this._isVisible)
                    this._overlay.opacity = INACTIVE_OPACITY;
            },
        });
    }

    _showContainers() {
        this._container?.show();
        this._leftContainer?.show();
    }

    _hideContainers() {
        this._container?.hide();
        this._leftContainer?.hide();
    }

    // Reposition overlay
    _repositionOverlay() {
        if (!this._overlay) return false;
        const panel = Main.panel;
        if (!panel) return false;
        const [x, y] = panel.get_transformed_position();
        const w = panel.width;
        const h = panel.height;

        if (w === 0 || h === 0)
            return false;

        this._overlay.set_position(x, y);
        this._overlay.set_size(w, h);
        this._layoutContainers(false);
        this._positioned = true;
        debugLog(`reposition overlay ${w}x${h} at ${x},${y}`);
        return true;
    }
}

package net.rdztilegroup.deliveries;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import android.location.Location;
import android.os.Looper;

import androidx.core.content.ContextCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Keeps location reporting alive on phones that fight background work.
 *
 * A foreground service (which the GPS plugin already runs) is the strongest
 * guarantee stock Android offers, but it is NOT enough on its own:
 *
 *  - Doze: with the screen off and the phone still, Android throttles work
 *    unless the app is exempt from battery optimisation. A truck at a long
 *    stop looks exactly like a phone on a nightstand.
 *  - OEM battery managers: Samsung, Xiaomi, Oppo, Huawei and others add their
 *    own killers on top, each with a settings screen no app can change
 *    programmatically — by design. The best any app can do is take the driver
 *    straight to the right screen.
 *
 * So this exposes: is the app exempt, ask for the exemption, and open the
 * manufacturer's own screen when there is one.
 */
@CapacitorPlugin(
    name = "BatteryGuard",
    permissions = {
        // Foreground location. COARSE rides along because Android 12+ lets the
        // driver grant only the approximate one.
        @Permission(
            alias = "location",
            strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }
        ),
        // "Allow all the time". On Android 11+ this CANNOT be bundled with the
        // dialog above — Android insists it be asked for separately, after
        // foreground location is already granted.
        @Permission(
            alias = "backgroundLocation",
            strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }
        ),
        // The foreground service's permanent notification (Android 13+).
        // Without it the service still runs, but the driver loses the one
        // visible sign that sharing is on.
        @Permission(
            alias = "notifications",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        )
    }
)
public class BatteryGuardPlugin extends Plugin {

    /**
     * Everything that has to be true for a shift to be trackable, read in one
     * call so the app can gate on it.
     *
     * Each value is a tri-state: true = granted, false = denied, and ABSENT
     * when this Android version has no such concept. Absent must never be
     * treated as denied — blocking a driver over a setting that doesn't exist
     * on their phone would leave them unable to work.
     */
    @PluginMethod
    public void permissionState(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("location", granted(Manifest.permission.ACCESS_FINE_LOCATION)
            || granted(Manifest.permission.ACCESS_COARSE_LOCATION));
        // Below Android 10 there is no separate background permission: holding
        // foreground location is enough.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ret.put("backgroundLocation", granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION));
        }
        // Notification permission only exists from Android 13.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ret.put("notifications", granted(Manifest.permission.POST_NOTIFICATIONS));
        }
        ret.put("battery", isExempt());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            ret.put("hibernation", isHibernationExempt());
        }
        ret.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
        ret.put("hasOemSettings", oemIntent() != null);
        ret.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    /** Ask for foreground location. */
    @PluginMethod
    public void requestLocation(PluginCall call) {
        requestPermissionForAlias("location", call, "afterLocation");
    }

    @PermissionCallback
    private void afterLocation(PluginCall call) {
        permissionState(call);
    }

    /**
     * Ask for "allow all the time".
     *
     * Only offered once foreground location is held — asking first is an
     * automatic denial on Android 11+, which would teach the driver the button
     * is broken.
     */
    @PluginMethod
    public void requestBackgroundLocation(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) { permissionState(call); return; }
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "afterLocation");
            return;
        }
        requestPermissionForAlias("backgroundLocation", call, "afterLocation");
    }

    /** Ask to post the service's notification (Android 13+). */
    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) { permissionState(call); return; }
        requestPermissionForAlias("notifications", call, "afterLocation");
    }

    /** Open this app's own settings page, for anything Android refuses to ask
     * for twice (a permanently denied permission lands here). */
    @PluginMethod
    public void openAppSettingsPage(PluginCall call) {
        openAppSettings();
        call.resolve(new JSObject().put("opened", true));
    }

    // ---- Time-based position reporting ------------------------------------
    //
    // The GPS plugin reports on DISTANCE: it asks Android for a fix every
    // second at high accuracy, then throws away everything that hasn't moved
    // 40 m. So a parked truck reports nothing, and a day comes back with six
    // hours nobody can account for — while the battery for those six hours has
    // already been spent computing positions we discarded.
    //
    // This adds a second subscription that reports on TIME instead. It costs
    // effectively nothing: Play Services merges both requests, and the
    // high-accuracy one-second request is already there.
    //
    // The fixes are handed to the web layer, which uploads them. Android
    // suspends that layer in the background, but the events queue and flush on
    // wake with the capture time intact — measured in production at over an
    // hour late and still correctly stamped. Reporting every couple of minutes
    // keeps that queue in the dozens, not the thousands.

    private FusedLocationProviderClient fused;
    private LocationCallback timedCallback;

    /** Start reporting a position every `intervalMs`, moving or not. */
    @PluginMethod
    public void startTimedPositions(PluginCall call) {
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION) && !granted(Manifest.permission.ACCESS_COARSE_LOCATION)) {
            call.reject("Location permission not granted");
            return;
        }
        long interval = call.getLong("intervalMs", 120000L);
        stopTimed();
        try {
            fused = LocationServices.getFusedLocationProviderClient(getContext());
            LocationRequest req = LocationRequest.create();
            req.setInterval(interval);
            req.setFastestInterval(interval);
            // BALANCED, not HIGH_ACCURACY: the other subscription already runs
            // the GPS flat out, so asking for high accuracy here would buy
            // nothing and cost battery on any day it doesn't.
            req.setPriority(LocationRequest.PRIORITY_BALANCED_POWER_ACCURACY);
            // Zero on purpose. Distance is the other subscription's job; this
            // one exists precisely to report a truck that ISN'T moving.
            req.setSmallestDisplacement(0f);

            timedCallback = new LocationCallback() {
                @Override
                public void onLocationResult(LocationResult result) {
                    Location loc = result == null ? null : result.getLastLocation();
                    if (loc == null) return;
                    JSObject fix = new JSObject();
                    fix.put("lat", loc.getLatitude());
                    fix.put("lng", loc.getLongitude());
                    fix.put("accuracy", loc.hasAccuracy() ? loc.getAccuracy() : null);
                    fix.put("speed", loc.hasSpeed() ? loc.getSpeed() : null);
                    fix.put("bearing", loc.hasBearing() ? loc.getBearing() : null);
                    // The capture time, never the delivery time — the whole
                    // point is that these arrive late and must still say when
                    // the truck was actually there.
                    fix.put("time", loc.getTime());
                    notifyListeners("timedPosition", fix, true);
                }
            };
            fused.requestLocationUpdates(req, timedCallback, Looper.getMainLooper());
            call.resolve(new JSObject().put("started", true).put("intervalMs", interval));
        } catch (SecurityException e) {
            call.reject("Location permission refused by the system");
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "Could not start timed positions" : e.getMessage());
        }
    }

    /** Stop it. Called on clock-out; leaving it running would report a driver
     * on their own time. */
    @PluginMethod
    public void stopTimedPositions(PluginCall call) {
        stopTimed();
        call.resolve(new JSObject().put("stopped", true));
    }

    private void stopTimed() {
        try {
            if (fused != null && timedCallback != null) fused.removeLocationUpdates(timedCallback);
        } catch (Exception ignored) {
            // Already gone; nothing to undo.
        }
        timedCallback = null;
    }

    @Override
    protected void handleOnDestroy() {
        stopTimed();
        super.handleOnDestroy();
    }

    private boolean granted(String perm) {
        return ContextCompat.checkSelfPermission(getContext(), perm) == PackageManager.PERMISSION_GRANTED;
    }

    /** Is the app already exempt from battery optimisation? */
    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ignoring", isExempt());
        ret.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
        ret.put("hasOemSettings", oemIntent() != null);
        ret.put("hibernationExempt", isHibernationExempt());
        call.resolve(ret);
    }

    /**
     * Ask Android to stop hibernating the app.
     *
     * This is NOT the same thing as battery optimisation, and that distinction
     * is why a driver can grant every permission and still lose tracking:
     * "Pause app activity if unused" (Android 11+) suspends the app and revokes
     * its permissions after a stretch of not being OPENED. A driver whose phone
     * sits in a cradle all day is using the app constantly — but never touching
     * it, which is what Android actually measures.
     *
     * The system screen is the only way to change it; no app may set it.
     */
    @PluginMethod
    public void requestHibernationExemption(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            call.resolve(new JSObject().put("exempt", true).put("opened", false));
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_AUTO_REVOKE_PERMISSIONS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(new JSObject().put("exempt", false).put("opened", true));
        } catch (Exception e) {
            // Some builds don't expose the dedicated screen; the app's own
            // settings page carries the same toggle.
            openAppSettings();
            call.resolve(new JSObject().put("exempt", false).put("opened", true));
        }
    }

    /**
     * Ask Android to exempt the app. Shows the system dialog; the driver still
     * has to accept, which is the point — this is a permission, not a
     * back door.
     */
    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        if (isExempt()) {
            JSObject ret = new JSObject();
            ret.put("ignoring", true);
            call.resolve(ret);
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            // The dialog is async and gives no result, so report the state as
            // it was — the app re-checks when it next comes to the foreground.
            ret.put("ignoring", false);
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception e) {
            // Some builds hide this dialog. Fall back to the app's own
            // settings page rather than failing silently.
            openAppSettings();
            call.resolve(new JSObject().put("ignoring", false).put("opened", true));
        }
    }

    /**
     * Open the manufacturer's own auto-start / protected-apps screen. These
     * cannot be toggled programmatically, so the driver taps through it once
     * with the phone in hand.
     */
    @PluginMethod
    public void openOemSettings(PluginCall call) {
        Intent intent = oemIntent();
        try {
            if (intent != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            } else {
                openAppSettings();
            }
            call.resolve(new JSObject().put("opened", true));
        } catch (Exception e) {
            openAppSettings();
            call.resolve(new JSObject().put("opened", true));
        }
    }

    /**
     * True when the app is exempt from hibernation / permission auto-reset.
     * Below Android 11 the feature does not exist, so nothing can pause us
     * this way and the honest answer is "exempt".
     */
    private boolean isHibernationExempt() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return true;
        try {
            PackageManager pm = getContext().getPackageManager();
            return pm.isAutoRevokeWhitelisted();
        } catch (Exception e) {
            // Unknown is reported as exempt rather than nagging a driver about
            // a setting we could not read.
            return true;
        }
    }

    private boolean isExempt() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    private void openAppSettings() {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
        } catch (Exception ignored) {
            // Nothing further we can do; the caller already told the driver
            // what to look for.
        }
    }

    /**
     * The known auto-start screens, by manufacturer. Each is resolved before
     * being offered, so a phone whose vendor moved or removed the screen falls
     * back to the standard app-settings page instead of crashing.
     */
    private Intent oemIntent() {
        String mfr = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase();
        Intent intent = new Intent();
        switch (mfr) {
            case "xiaomi":
            case "redmi":
            case "poco":
                intent.setClassName("com.miui.securitycenter",
                        "com.miui.permcenter.autostart.AutoStartManagementActivity");
                break;
            case "oppo":
            case "realme":
                intent.setClassName("com.coloros.safecenter",
                        "com.coloros.safecenter.permission.startup.StartupAppListActivity");
                break;
            case "vivo":
                intent.setClassName("com.vivo.permissionmanager",
                        "com.vivo.permissionmanager.activity.BgStartUpManagerActivity");
                break;
            case "huawei":
            case "honor":
                intent.setClassName("com.huawei.systemmanager",
                        "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity");
                break;
            case "samsung":
                intent.setClassName("com.samsung.android.lool",
                        "com.samsung.android.sm.ui.battery.BatteryActivity");
                break;
            default:
                return null;
        }
        // Only offer it if the screen actually exists on this phone.
        if (getContext().getPackageManager().resolveActivity(intent, 0) == null) return null;
        return intent;
    }
}

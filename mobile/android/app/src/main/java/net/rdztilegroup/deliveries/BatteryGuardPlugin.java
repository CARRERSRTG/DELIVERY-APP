package net.rdztilegroup.deliveries;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

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
@CapacitorPlugin(name = "BatteryGuard")
public class BatteryGuardPlugin extends Plugin {

    /** Is the app already exempt from battery optimisation? */
    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ignoring", isExempt());
        ret.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
        ret.put("hasOemSettings", oemIntent() != null);
        call.resolve(ret);
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

package net.rdztilegroup.deliveries;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        // Registered before super so the bridge picks it up on first load —
        // the web app checks battery-optimisation state as soon as a driver
        // clocks in.
        registerPlugin(BatteryGuardPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

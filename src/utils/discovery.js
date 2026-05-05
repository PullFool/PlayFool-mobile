// Wraps react-native-zeroconf so SyncScreen can scan for desktop PlayFool
// instances broadcasting `_playfool._tcp` over mDNS.
import Zeroconf from 'react-native-zeroconf';

let zeroconf = null;

function ensure() {
  if (!zeroconf) zeroconf = new Zeroconf();
  return zeroconf;
}

// onChange receives the current list of discovered services as
// [{ name, host, port, addresses[] }, ...]
export function startDiscovery(onChange) {
  const z = ensure();
  const services = new Map();

  const emit = () => {
    onChange(Array.from(services.values()));
  };

  const onResolved = (svc) => {
    if (!svc) return;
    services.set(svc.name, {
      name: svc.name,
      host: svc.host,
      port: svc.port,
      addresses: svc.addresses || [],
    });
    emit();
  };
  const onRemove = (name) => {
    services.delete(name);
    emit();
  };
  const onError = () => { /* network error during scan, ignore */ };

  z.on('resolved', onResolved);
  z.on('remove', onRemove);
  z.on('error', onError);

  try { z.scan('playfool', 'tcp', 'local.'); } catch (e) {}
  return () => {
    try { z.stop(); } catch (e) {}
    z.removeDeviceListeners?.();
    z.off?.('resolved', onResolved);
    z.off?.('remove', onRemove);
    z.off?.('error', onError);
  };
}

export function stopDiscovery() {
  try { if (zeroconf) zeroconf.stop(); } catch (e) {}
}

// Pick the most likely reachable IPv4 from the addresses Zeroconf returned.
export function pickAddress(svc) {
  if (!svc) return '';
  const addrs = svc.addresses || (svc.host ? [svc.host] : []);
  // Prefer IPv4 (no colons), skip link-local 169.254.x and IPv6.
  const ipv4 = addrs.filter((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a) && !a.startsWith('169.254.'));
  return ipv4[0] || addrs[0] || '';
}

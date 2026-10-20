#!/usr/bin/env bash
# Brodoit for Android on an emulator, the way a tester meets it (run by .github/workflows/android.yml):
#   install → first open asks for Physical activity → Allow → brodoit.com opens in the app
#   → the brodoit://enable deep link opens the steps screen → a periodic sync job is scheduled → nothing crashed.
#   bash android-smoke.sh <apk> <out dir>
set -u
APK="$1"; OUT="$2"; PKG=com.brodoit.app
mkdir -p "$OUT"
fails=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }
shot() { adb exec-out screencap -p > "$OUT/$1.png" 2>/dev/null || true; }
# the screen as text (uiautomator); a dump sometimes fails mid-animation, so a few tries
dump() {
  for _ in 1 2 3 4 5; do
    adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1 && adb exec-out cat /sdcard/ui.xml > "$OUT/ui.xml" 2>/dev/null && grep -q '<node' "$OUT/ui.xml" && return 0
    sleep 2
  done
  return 1
}
# wait until the screen shows text matching $1 (case-insensitive), up to $2 seconds
wait_for() {
  local t=0
  while [ "$t" -lt "$2" ]; do dump && grep -qiE "$1" "$OUT/ui.xml" && return 0; sleep 3; t=$((t + 3)); done
  return 1
}
# tap the first node whose text or resource-id matches $1
tap() {
  dump || return 1
  local b
  b=$(grep -oE "<node [^>]*(text=\"$1\"|resource-id=\"[^\"]*$1\")[^>]*>" "$OUT/ui.xml" | head -1 | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | grep -oE '[0-9]+' | tr '\n' ' ')
  [ -n "$b" ] || return 1
  set -- $b
  adb shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
}

adb logcat -c || true
adb install -r "$APK" > "$OUT/install.txt" 2>&1 && ok "installs ($(tail -1 "$OUT/install.txt"))" || { bad "install: $(cat "$OUT/install.txt")"; exit 1; }
adb shell pm list packages | grep -q "package:$PKG" && ok "the package is $PKG" || bad "package $PKG not listed"

# first open: the app asks for Physical activity straight away
adb shell am start -W -n "$PKG/$PKG.LauncherActivity" > "$OUT/start.txt" 2>&1
wait_for 'physical activity' 60 && ok "first open asks for Physical activity" || bad "no Physical activity request on first open"
shot 1-permission
tap 'permission_allow_button' || tap 'Allow' || bad "could not tap Allow"
sleep 3
adb shell dumpsys package "$PKG" | grep -q 'android.permission.ACTIVITY_RECOGNITION: granted=true' && ok "Physical activity allowed" || bad "Physical activity not granted"

# then brodoit.com opens inside the app (a Trusted Web Activity; with this test key the browser shows the address)
front() { adb shell dumpsys activity activities | grep -E 'ResumedActivity' | head -1; }
opened=0
for _ in $(seq 1 30); do
  if dump && grep -qi 'brodoit' "$OUT/ui.xml"; then opened=1; break; fi
  front | grep -qiE 'customtab|chrome|browser|webview' && { sleep 6; opened=2; break; }
  sleep 3
done
case $opened in 1) ok "brodoit.com opens in the app";; 2) ok "brodoit.com opens in the app's browser tab ($(front | grep -oE '[a-z.]+/[A-Za-z0-9_.]+' | head -1))";; *) bad "brodoit.com did not open (front: $(front))";; esac
shot 2-app

# a periodic sync job is scheduled (steps keep syncing with the app closed)
adb shell dumpsys jobscheduler | grep -q "$PKG" && ok "a background sync job is scheduled" || bad "no background job for $PKG"

# the steps deep link the web app uses (brodoit://enable) opens the app's steps screen
adb shell am start -W -a android.intent.action.VIEW -d 'brodoit://enable' "$PKG" > "$OUT/deeplink.txt" 2>&1
grep -qE 'Status: ok|EnableStepsActivity|LauncherActivity' "$OUT/deeplink.txt" && ok "brodoit://enable opens the app" || bad "deep link: $(tr '\n' ' ' < "$OUT/deeplink.txt")"
sleep 8; shot 3-deeplink

# nothing crashed
adb logcat -d > "$OUT/logcat.txt" 2>&1
if grep -E 'FATAL EXCEPTION' -A3 "$OUT/logcat.txt" | grep -q "$PKG"; then bad "the app crashed: $(grep -A6 'FATAL EXCEPTION' "$OUT/logcat.txt" | head -8 | tr '\n' ' ')"; else ok "no crash"; fi

echo "android smoke: $fails failed"
[ "$fails" -eq 0 ]

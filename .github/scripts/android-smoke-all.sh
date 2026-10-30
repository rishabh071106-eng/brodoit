#!/usr/bin/env bash
# Both Android builds on one emulator: the direct APK (Trusted Web Activity) and the Google Play build (WebView).
#   bash android-smoke-all.sh <direct apk> <play apk> <api level>
set -u
bash .github/scripts/android-smoke.sh "$1" "shots-$3"; a=$?
bash .github/scripts/android-smoke-play.sh "$2" "shots-play-$3"; b=$?
[ "$a" -eq 0 ] && [ "$b" -eq 0 ]

# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Add any project specific keep options here:

# Add any project specific keep options here:

# libtorrent4j (Required for JNI to find the classes and methods)
-keep class org.libtorrent4j.** { *; }
-keep interface org.libtorrent4j.** { *; }
-keep enum org.libtorrent4j.** { *; }

# Keep custom native modules (both com.vega and dynamic package)
-keep class com.vega.** { *; }
-keep class com.vega.fork.** { *; }

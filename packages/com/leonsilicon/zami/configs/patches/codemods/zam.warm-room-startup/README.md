# @-/com.leonsilicon.zami.configs.patches.codemods.zam.warm-room-startup

A restored Matrix session reads its existing per-device room snapshot while
opening the SDK store and crypto. It shows the saved room list while sync
reconnects, and builds older cached timeline events when their room is opened.
The SDK's older cache can fill in live room objects during startup. The room
list snapshot stays available until the first live sync.

# @-/com.leonsilicon.zami.configs.patches.codemods.zam.warm-room-startup

A restored Matrix session reads its existing per-device room snapshot while
opening the SDK store and crypto. It shows the saved room list while sync
reconnects, and builds older cached timeline events when their room is opened.
The SDK's older cache can fill in live room objects during startup. The room
list snapshot stays available until the first live sync.

Loading the saved sync doesn't wait for the network: the homeserver's `/versions` answer
from the last launch stands in for this one's while the SDK starts. It also waits for
Zami's launch frame to hand over to the app, since it holds the main thread while it runs.

# @-/com.leonsilicon.zami.configs.patches.codemods.zam.call-audio-cleanup

Releases the Web Audio context after the last call cue or ringtone ends. On iOS, backgrounding also clears short cues whose audio clock may be frozen. Hanging up detaches remote audio before waiting for the call transport to disconnect.

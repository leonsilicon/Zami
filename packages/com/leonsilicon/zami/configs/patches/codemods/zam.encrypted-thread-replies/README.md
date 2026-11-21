# @-/com.leonsilicon.zami.configs.patches.codemods.zam.encrypted-thread-replies

The Matrix SDK counts replies using the `m.thread` relation on the encrypted event. The
decrypted message can omit that relation. Read the wire relation when selecting replies
to display and when refreshing an open thread as replies arrive.

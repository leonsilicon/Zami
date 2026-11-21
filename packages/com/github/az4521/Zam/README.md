# @-/com.github.az4521.zam

Zami's workspace package for reading upstream Zam. It reads the Git objects of the
commit pinned by the superproject's index at `repos/com/github/az4521/Zam`. Running
the web build or codemod checks leaves the submodule's files untouched.

`zamTree(root)` lists the pinned files, `readZamBlobs(root, shas)` reads their Git
blobs in batches, and `readZamFile(root, path)` reads one file by path. `root` is the
Zami checkout. Consumers import this package by name.

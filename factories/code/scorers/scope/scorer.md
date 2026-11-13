---
measure: scope
---
Did the diff stay inside the files the spec named? The share of the files the handed-off patch touches that are among the case's `files`, from 0 to 1. A rename counts both its paths.

It grades implement runs that handed off a patch. The case's `files` stand in for the files the spec named: they are the reference PR's file list, which is what a person decided the change needed. A spec stage writes its own list, in prose, which this scorer does not read. A lower score is not always worse, since a patch can rightly touch a file the reference did not, but it is a change a reviewer has to look at.

The reason names the files outside the list.

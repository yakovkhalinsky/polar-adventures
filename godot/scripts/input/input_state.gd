## The four things the hero reads, in one place.
##
## A **global** class rather than a nested one, because a module reached through
## `preload()` is untyped: `preloaded.SOME_CONST` is a Variant at compile time, so
## `:=` cannot infer through it and every use site needs an explicit annotation.
## `class_name` makes the names statically known, which is the difference between
## `var accel := Movement.TURN_ACCEL` compiling and not.
##
## Fields default to false, so a fresh state means "nothing pressed" — handy when a
## test or a driver only cares about one axis.

class_name InputState
extends RefCounted

var left := false
var right := false
var jump_down := false
var jump_pressed := false

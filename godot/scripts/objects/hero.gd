## The bear. Physics only in `tick`; presentation is a separate call.
##
## IT EXTENDS `HeightMover`, which is the movement model — the same model the height-field
## probe graded. Inheriting rather than copying is deliberate: the probe's whole value is
## that it measures the thing the game runs, and a second implementation would let them
## drift until the probe was measuring a character nobody plays.
##
## What this adds is the two seams around the model: INPUT and PRESENTATION. Neither
## writes movement state, and `tick` reads neither.
##
##   input        four screen keys become ONE lattice direction, because the lattice axes
##                are the screen diagonals but keyboards have no diagonal keys.
##   presentation the sprite, the facing and the animation, driven by state the model has
##                already settled.
##
## The root node sits at the character's FEET — `HeightMover.place()` puts it at the
## projected feet position — so `position.y` is the depth sort key and nothing computes
## one.

class_name Hero
extends HeightMover

const STRIP_DIR := "res://art/bear"

## Where the sprite sits relative to the feet. The frames are registered with the feet on
## the bottom row, and the sprite is centred, so the drawn image hangs half a frame above
## the origin.
var sprite_offset := Vector2.ZERO

## Set by a test or a driver to move the hero without a keyboard; null reads the real
## InputMap. The same seam the side-view hero had, for the same reason: synthesising
## input events would couple every measurement to the input system and to the order Godot
## dispatches events in.
var input_override: Dictionary = {}


## -1, 0 or 1 per lattice axis, or a value from `input_override`. Not a screen direction:
## which screen direction a lattice axis becomes is the projection's business.
var _dir := Vector2.ZERO
var _jump_down := false
var _jump_pressed := false

@onready var _sprite: AnimatedSprite2D = get_node_or_null(^"Sprite")


func _ready() -> void:
	super()
	if _sprite != null:
		var frames := BearFrames.build(STRIP_DIR)
		if frames != null:
			_sprite.sprite_frames = frames
			if frames.get_animation_names().has("idle-south-east"):
				_sprite.play("idle-south-east")
		# Feet on the ground line: the sprite is centred and the frames are registered
		# with the feet on the bottom row.
		var region := Rect2()
		if _sprite.sprite_frames != null:
			var tex := _sprite.sprite_frames.get_frame_texture(
				_sprite.animation, 0
			)
			if tex != null:
				region = Rect2(Vector2.ZERO, tex.get_size())
		sprite_offset = Vector2(0.0, -region.size.y / 2.0)
		_sprite.position = sprite_offset


func _physics_process(delta: float) -> void:
	_read_input()
	tick(delta * 1000.0, _dir, _jump_down, _jump_pressed)
	_update_presentation()


## Presentation only. Reads state; never writes movement state and never decides anything
## physical.
##
## This is the `Player.present()` split the side-view build designed, documented and
## implemented halfway; here physics runs in `_physics_process`, this is called
## immediately after it, and the sprite is a child node rather than the character itself,
## so the boundary is structural rather than a convention.
func _update_presentation() -> void:
	if _sprite == null or _sprite.sprite_frames == null:
		return
	var facing := _facing_name()
	var clip := _clip_name()
	var anim := "%s-%s" % [clip, facing]
	if not _sprite.sprite_frames.get_animation_names().has(anim):
		return
	# `ignoreIfPlaying`, or calling play() every frame restarts the animation and the
	# bear sits on frame 0 forever. This is the same trap the side-view build documented.
	if _sprite.animation != anim:
		_sprite.play(anim)
	# `speed_scale` is per-sprite and STICKY: only the run branch writes it, so every
	# other state has to reset it or it inherits the last run value.
	if clip == "run" and Movement.MAX_RUN_SPEED > 0.0:
		_sprite.speed_scale = clampf(
			vel_uv.length() * screen_per_cell() / Movement.MAX_RUN_SPEED, 0.6, 1.25
		)
	else:
		_sprite.speed_scale = 1.0
	# The sprite is drawn facing left by default in the art's `west`-ish facings; there is
	# no mirroring because the four facings the game uses are all distinct.
	# `grounded` is one frame stale on takeoff — the tick read it before the jump wrote
	# velocity — so presentation tests the velocity too.
	_sprite.visible = true


## Which clip the current state wants, in the order the state machine settled on.
func _clip_name() -> String:
	var airborne := not grounded
	# Rising or falling is decided by the HEIGHT velocity, which is positive up.
	if airborne and vel_height > 0.0:
		return "jump"
	if airborne:
		return "fall"
	if vel_uv.length() > 0.6:
		return "run"
	return "idle"


## Facing as one of the four diagonals, which are the lattice axes on screen.
##
## Held rather than derived from velocity, so the character does not spin around when it
## stops — the same rule the side-view build pinned to input and left a comment about.
func _facing_name() -> String:
	var d := facing
	if d == Vector2.ZERO:
		d = FACING_FALLBACK
	# +u is down-right on screen, +v is down-left, and their negatives are the other two.
	if d.x > 0.0:
		return "south-east"
	if d.y > 0.0:
		return "south-west"
	if d.x < 0.0:
		return "north-west"
	return "north-east"


func _read_input() -> void:
	if not input_override.is_empty():
		_dir = input_override.get("dir", Vector2.ZERO)
		_jump_down = bool(input_override.get("jump_down", false))
		_jump_pressed = bool(input_override.get("jump_pressed", false))
		return

	var screen := Vector2(
		(1.0 if Input.is_action_pressed("move_right") else 0.0)
			- (1.0 if Input.is_action_pressed("move_left") else 0.0),
		(1.0 if Input.is_action_pressed("move_down") else 0.0)
			- (1.0 if Input.is_action_pressed("move_up") else 0.0),
	)
	_dir = direction_from_screen(screen)
	_jump_down = Input.is_action_pressed("jump")
	_jump_pressed = Input.is_action_just_pressed("jump")


## A screen direction, snapped to the nearest lattice axis.
##
## The player has four keys and the movement has four axes, but they point at different
## things: the lattice axes are the SCREEN DIAGONALS, so pressing Right alone is a tie
## between two of them. Holding two keys gives the genuine diagonals — up-right is `-v`,
## down-right is `+u` — and a single key resolves by a fixed tie-break so it is at least
## consistent. That is how isometric games controlled by a D-pad have always behaved.
static func direction_from_screen(screen: Vector2) -> Vector2:
	if screen == Vector2.ZERO:
		return Vector2.ZERO
	# The lattice basis in screen space: +u is (HALF_W, HALF_H), +v is (-HALF_W, HALF_H).
	# Inverting it gives the axis weights, and the larger one wins.
	var u := (screen.x / Iso.HALF_W + screen.y / Iso.HALF_H) * 0.5
	var v := (screen.y / Iso.HALF_H - screen.x / Iso.HALF_W) * 0.5
	if absf(u) >= absf(v):
		return Vector2(signf(u), 0.0)
	return Vector2(0.0, signf(v))

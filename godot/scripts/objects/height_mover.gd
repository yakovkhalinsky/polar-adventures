## A character that moves on a lattice and is subject to gravity, in the height-field
## model.
##
## DELIBERATELY NOT `Hero`. The probe's job is to find out whether this model can carry
## the movement at all, before the character that ships is rewritten around it. Sharing
## code with the thing being replaced would leave the probe unable to say whether the
## model or the old code was at fault.
##
## THE STATE IS (u, v, height), and only the first two are integrated horizontally.
## Screen position is DERIVED by the projection. That is the whole point: it lets a
## character walk along a lattice axis — which on screen means moving diagonally — while
## gravity pulls it straight down. Integrating screen Y instead would drive it into the
## floor it is standing on.
##
## The vertical maths is the ported model, unchanged in form: the same asymmetric
## gravity, the same stateless jump clamp, the same integrator. Only the axes it acts on
## have changed, which is what makes the apex still measurable in screen pixels — and
## still comparable to the 415.9px the Phaser build measured at a different scale.

class_name HeightMover
extends Node2D

## The tallest step the character can walk up. Anything higher is a wall. Without a
## limit the snap-to-ground rule would let it walk up a cliff, because "the ground is
## above me" and "the ground is a step above me" are otherwise the same test.
const STEP_UP := 12.0

## A stable facing for when the character stops, so something is always drawn.
const FACING_FALLBACK := Vector2(1.0, 0.0)


## The screen length of one cell's step along an axis. This is the ONLY place the two
## units meet: the movement constants are in screen pixels and the lattice is in cells,
## and every conversion between them goes through here rather than through a magic
## number that would be wrong the moment the tile size changed.
static func screen_per_cell() -> float:
	return Vector2(Iso.HALF_W, Iso.HALF_H).length()


## Which acceleration applies this frame.
##
## A PURE FUNCTION, and tested as one, because this is where the subtle rule lives:
## `is_turning` is decided BEFORE `grounded`, and a mid-air TURN uses TURN_ACCEL rather
## than AIR_ACCEL. That is deliberate — it is snappier than accelerating from rest in the
## air — and it was kept rather than silently "fixed". Folding the two branches into one
## expression would make an airborne turn read whichever constant happened to win.
##
## Testing it here rather than by measuring a frame of a real jump is the point: the rule
## is pure logic, and measuring it in a physics world would need the character to be
## genuinely airborne on a precise frame, which fails for timing reasons that have nothing
## to do with the rule. That happened once already, in the side-view harness.
static func accel_for(grounded: bool, turning_now: bool) -> float:
	if grounded:
		return Movement.TURN_ACCEL if turning_now else Movement.GROUND_ACCEL
	return Movement.TURN_ACCEL if turning_now else Movement.AIR_ACCEL


## Whether the input opposes the direction of travel — the other half of the rule.
##
## The side-view version was `moving != 0 and moving != dir` on scalars. On a lattice the
## direction of travel is a vector, so the same rule is a negative dot product: the input
## points some way, the travel points another, and it counts as a turn when they disagree.
## Standing still is still not a turn, whichever way you press.
static func turning(dir: Vector2, travel: Vector2) -> bool:
	if travel.length() <= 0.001:
		return false
	return travel.normalized().dot(dir.normalized()) < 0.0

var field: HeightField = null
var cell_pos := Vector2.ZERO  # (u, v), float
var elevation := 0.0  # screen px
var vel_uv := Vector2.ZERO  # cells/s
var vel_height := 0.0  # px/s
var grounded := false
var facing := FACING_FALLBACK

var _coyote_ms := 0.0
var _jump_buffer_ms := 0.0
var _blocked_this_tick := false


func _ready() -> void:
	place()


func place() -> void:
	position = Iso.lattice_to_screen(cell_pos.x, cell_pos.y, elevation)


func cell() -> Vector2i:
	return Vector2i(floori(cell_pos.x), floori(cell_pos.y))


func ground_height() -> float:
	return field.height_at(cell())


## `dir` is a lattice direction — one of the four unit axes, or zero. Not a screen
## direction: which screen direction that becomes is the projection's business.
func tick(delta_ms: float, dir: Vector2, jump_down: bool, jump_pressed: bool) -> void:
	var dt := delta_ms / 1000.0
	_blocked_this_tick = false

	# ---- 1. forgiveness windows ------------------------------------------
	_coyote_ms = Movement.COYOTE_MS if grounded else maxf(0.0, _coyote_ms - delta_ms)
	_jump_buffer_ms = (
		Movement.JUMP_BUFFER_MS if jump_pressed else maxf(0.0, _jump_buffer_ms - delta_ms)
	)

	# ---- 2. jump ---------------------------------------------------------
	# POSITIVE IS UP in this model, and that is the one place it differs from the ported
	# constants. They were written for a y-DOWN screen where gravity is positive and a
	# jump is negative; here `height` is an elevation, so the same numbers take the
	# opposite sign. Getting this wrong sends the character climbing instead of falling —
	# which is what the probe's first run did, with elevation reaching 584px in 40 frames.
	if _jump_buffer_ms > 0.0 and _coyote_ms > 0.0:
		vel_height = Movement.JUMP_VELOCITY
		_jump_buffer_ms = 0.0
		_coyote_ms = 0.0
		grounded = false

	# ---- 3. variable jump height -----------------------------------------
	if not jump_down and vel_height > Movement.JUMP_CUT_VELOCITY:
		vel_height = Movement.JUMP_CUT_VELOCITY

	# ---- 4. horizontal, on the lattice -----------------------------------
	# The ported model generalised from one axis to two: `is_turning` was "the input
	# opposes the direction of travel", which for a vector is a negative dot product.
	# A mid-air turn still uses TURN_ACCEL rather than AIR_ACCEL, because that quirk is
	# the same quirk.
	var step := screen_per_cell()
	var max_cells := Movement.MAX_RUN_SPEED / step
	if dir != Vector2.ZERO:
		var accel := accel_for(grounded, turning(dir, vel_uv))
		vel_uv += dir.normalized() * (accel / step) * dt
		vel_uv = vel_uv.limit_length(max_cells)
		facing = dir.normalized()
	else:
		var drag := Movement.GROUND_DRAG if grounded else Movement.AIR_DRAG
		vel_uv = vel_uv.move_toward(Vector2.ZERO, (drag / step) * dt)

	# ---- 5. asymmetric gravity, on HEIGHT --------------------------------
	# Subtracted, not added: rising is positive here. The asymmetry is unchanged — the
	# selector is still "am I rising", and the same 1.64 ratio.
	vel_height -= (
		Movement.GRAVITY_RISE if vel_height > 0.0 else Movement.GRAVITY_FALL
	) * dt
	if vel_height < -Movement.MAX_FALL_SPEED:
		vel_height = -Movement.MAX_FALL_SPEED

	# ---- 6. integrate, then resolve against the height field -------------
	var before := cell_pos
	cell_pos += vel_uv * dt
	elevation += vel_height * dt

	var here := cell()
	if not field.is_ground(here):
		# No ground under this cell: keep going, and let the fall be fatal.
		grounded = false
	elif elevation <= field.height_at(here):
		elevation = field.height_at(here)
		vel_height = 0.0
		grounded = true
	else:
		grounded = false

	# A step. The height field has no walls, so one is imposed here: if the ground
	# ahead is higher than a step, the move is refused rather than climbed.
	var ahead := Vector2i(
		floori(cell_pos.x + signf(vel_uv.x) * 0.5), floori(cell_pos.y + signf(vel_uv.y) * 0.5)
	)
	if grounded and field.is_ground(ahead) and field.height_at(ahead) > elevation + STEP_UP:
		cell_pos = before
		vel_uv = Vector2.ZERO
		_blocked_this_tick = true

	place()


## Whether the last tick refused a horizontal move because the step was too high.
func was_blocked() -> bool:
	return _blocked_this_tick

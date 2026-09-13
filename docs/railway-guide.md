# Building a railway that keeps moving

## Towns, housing and food

**Townhouse** is the civic anchor: it keeps the town's name, identity and seven-tile catchment.
Put a **House** and a **Warehouse** within that area to found the town. The Townhouse has no
passenger cargo. Build a separate **Station**, connected to track, for passenger service, and
run coaches between Stations with Dynamic — Transport or a schedule. Passenger production
depends on finished housing within seven tiles of the Station.

Houses hold 20, 60, 140 and 300 residents at levels 1–4. Select a completed House and use
**Enlarge** to pay for the next level. Its appearance progresses from house to apartments,
high-rise and skyscraper. Residents fill available homes while food is available; the game
does not construct free housing or grant free upgrades. A sliding 6×6 area with at least 200
town residents gains city paving and roads. These are cosmetic and do not replace rails.

Bring wheat from a Farm Halt to a Depot, then build a **Windmill** from Works. Its base recipe
is one wheat to five food, at up to 60 batches per week. Levels 2–4 improve that ratio to 7,
9 and 11 food; each upgrade also increases throughput by half the base rate. Residents and
crews each use one food per week at default tuning. Food can also be bought on the Market.
Refineries now need two stone per batch, alongside their previous inputs.

Production, consumption and market deals use seven-day weeks. Production and upkeep flow
through the week; standing deals settle once a week, and fuel prices also change weekly.
Resource quantities turn green for a positive net flow and red for a negative one. Hover to
see actual amounts received and spent over the last seven days, including construction and
refuelling. The rolling history starts when the game is loaded; initial stock is excluded.

## Fuel service

Put a **Water Tower** and **Coaling Stage** within two tiles of the rail on an accessible service
track. They transfer water and fuel from your stockpile; they do not produce those resources.
Placing them together provides a complete steam service stop. A loop or siding is useful so
a servicing train does not obstruct the main line.

Trains check reserves while travelling and before departures. They start looking around 40%
remaining, or sooner when the planned leg requires more reserve, then choose a nearby service
reachable along usable track. When fuel and water services are separate, the limiting reserve
is filled first. The scheduled destination and cargo program resume after servicing, including
dynamic routes. Keep resources stocked and leave a usable route to service: an empty tank or
an isolated service track still needs assistance.

**Refuel all · 2×** in the train-list header is emergency delivery. In field view it fills only
the listed trains; in overview it fills the fleet. It costs twice the usual amount of resources.
If there is not enough stock to fill every selected train, it charges nothing and changes no
tanks. Normal service has the ordinary resource cost.

## Semaphores as block boundaries

Choose **Utility → Semaphore** and place a post on track. Rotate with **R** before placement,
or select it afterwards and use **Rotate direction**. The panel names the governed travel
direction and highlights the protected stretch. The header's **Signals?** button opens the
same practical guidance inside the game.

```text
travel →  A ═════ block A–B ═════ B ═════ block B–C ═════ C
                  one train                  next block
```

A post guards the rail beyond it up to the next post governing travel along that route.
The exit post's tile belongs to the guarded stretch too, so the previous train must clear it.

- **Red / horizontal home arm:** another train occupies the protected block. Stop before entry.
- **Yellow / caution:** this block is clear, but the following block is occupied. Approach slowly.
- **Green / raised arms:** both blocks are clear. Reservations and junction checks still apply.

Put posts at the entry and exit of the stretch you want to protect. Space them at least one
full train length plus a tile apart. Before a junction, place the entry post on its approach;
put exit posts beyond each branch, with room for the complete train to leave the junction.
Posts operate in **Automatic** mode as soon as they are placed. Track without posts keeps
ordinary traffic reservations.

For two-way single track, provide passing loops long enough for the entire consist. Put posts
on both approaches, facing into the shared line. **Token working** in Settings gives one
train ownership of a shared plain section until its rear clears. Semaphores alone cannot
provide the missing space needed for two oncoming trains to pass. At a switch the selected
post's preview follows the straight continuation; a train checks the branch on its actual path.

The debug traffic panel shows blocking groups and active escape owners. Recovery reserves
one escape route per conflicting group, and can first move a queue that obstructs another
train's retreat. If no reachable siding fits the full train, add a longer loop or another route.

## Bridges

From **Track**, build Wooden Bridge or Stone Bridge platforms on water. Then lay ordinary
track on them. Straight rails on consecutive platforms of the same material join visually
into timber trusses or masonry arches with supports. Regular and high-speed rails can both
use a platform; normal class transitions are still required where classes meet.

| Platform      | Base material cost | Capacity | Half speed above |
| ------------- | ------------------ | -------- | ---------------- |
| Wooden Bridge | 24 wood            | 180 t    | 144 t            |
| Stone Bridge  | 35 stone           | 650 t    | 520 t            |

The limit uses the entire consist's mass: locomotives, wagons and cargo. An overweight route
is excluded from pathfinding. Above 80% capacity, crossing speed is halved until the rear
leaves the bridge. A train exactly at capacity may cross at half speed.

Select a platform to inspect its limit and pay for reinforcement. Each level adds 25% of the
base capacity, up to level 4, and adds visible reinforcement. Upgrade every platform in the
crossing for heavier traffic: its weakest platform remains the limiting one. Remove track
before demolishing its platform. The removal tool removes the rails first on an occupied deck.

## Crafting and old saves

The Craft screen filters steam, diesel, electric and wagon cargo types and searches by model.
Each recipe shows its size, mass and useful properties. Click the vehicle image or **Inspect
3D** to rotate the complete procedural railcraft through its isometric headings; drag or use
the angle slider to inspect the wheels, bogies and articulated sections.

Old saves retain their Townhouses, names and town membership. Their former passenger stores
are removed, and obsolete passenger contracts expire without fines. Add passenger Stations
and update old passenger schedules to use them. Existing fixed bridge tracks become wooden
platforms with straight rails and the new capacity limits. Housing is retained, with the new
capacities; food reserves are added to ease the switch from raw wheat. Buying an edge chunk
uses a short world reload and preserves the selected running speed.

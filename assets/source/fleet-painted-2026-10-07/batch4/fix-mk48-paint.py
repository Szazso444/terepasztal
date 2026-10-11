import bpy,json,hashlib
from pathlib import Path
R=Path(__file__).resolve().parent;P=R/'prepared/mk48';p=P/'candidate.json';m=json.loads(p.read_text());part=next(x for x in m['parts'] if x['name']=='body');bpy.ops.wm.open_mainfile(filepath=part['source'])
for mat in bpy.data.materials:
 if not mat.use_nodes:continue
 ns=mat.node_tree.nodes;lk=mat.node_tree.links;bs=next((n for n in ns if n.type=='BSDF_PRINCIPLED'),None)
 if not bs or not bs.inputs['Base Color'].is_linked:continue
 colour=bs.inputs['Base Color'].links[0].from_socket
 sep=ns.new('ShaderNodeSeparateColor');lk.new(colour,sep.inputs[0])
 def op(kind,a,b):
  n=ns.new('ShaderNodeMath');n.operation=kind
  if isinstance(a,(int,float)):n.inputs[0].default_value=a
  else:lk.new(a,n.inputs[0])
  if isinstance(b,(int,float)):n.inputs[1].default_value=b
  else:lk.new(b,n.inputs[1])
  return n.outputs[0]
 blue=op('MULTIPLY',op('GREATER_THAN',op('SUBTRACT',sep.outputs[2],sep.outputs[0]),.04),op('GREATER_THAN',op('SUBTRACT',sep.outputs[2],sep.outputs[1]),.04))
 geo=ns.new('ShaderNodeNewGeometry');xyz=ns.new('ShaderNodeSeparateXYZ');lk.new(geo.outputs['Position'],xyz.inputs[0]);low=op('LESS_THAN',xyz.outputs['Z'],1.35)
 grey=ns.new('ShaderNodeRGBToBW');lk.new(colour,grey.inputs[0]);value=op('MULTIPLY',grey.outputs[0],.65)
 mix=ns.new('ShaderNodeMixRGB');lk.new(op('MULTIPLY',blue,low),mix.inputs[0]);lk.new(colour,mix.inputs[1]);lk.new(value,mix.inputs[2]);lk.new(mix.outputs[0],bs.inputs['Base Color'])
bpy.ops.wm.save_as_mainfile(filepath=part['source']);part['source_sha256']=hashlib.sha256(Path(part['source']).read_bytes()).hexdigest();m['reference']['prepared_sources']['body']=part['source_sha256'];m['reference']['guidelines']+='; Lower-frame blue reconstruction colour spill neutralized in the 3D material; cab glazing preserved.';p.write_text(json.dumps(m,indent=2)+'\n')

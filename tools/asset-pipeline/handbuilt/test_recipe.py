"""Reference boundaries: never silently adopt changed art or runtime geometry."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('handbuilt_cli',HERE/'run.py')
cli=importlib.util.module_from_spec(spec);spec.loader.exec_module(cli)


class RecipeBoundary(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.base=Path(self.tmp.name);self.png=self.base/'reference.png'
        Image.new('RGB',(8,8),'red').save(self.png)
        self.root=self.base/'asset';cli.initialize('example',[self.png],self.root)
        self.path=self.root/'project.json'
        (self.root/'build.py').write_text('# Reference-authored recipe\n')
        cli.write(self.root/'observations.json',{'observed':[{'picture':'view1','region':[0,0,1,1],'detail':'One red rectangular shell'}], 'inferred':[], 'omitted':[], 'guidelines':'Only this PNG'})

    def test_input_png_is_copied_and_locked(self):
        root,data,_=cli.load(self.path)
        self.assertEqual(cli.sha(root/data['pictures'][0]['path']),data['pictures'][0]['sha256'])

    def test_changed_reference_is_rejected(self):
        Image.new('RGB',(8,8),'blue').save(self.root/'references/01.png')
        with self.assertRaisesRegex(ValueError,'Reference PNG changed'):cli.load(self.path)

    def test_runtime_geometry_is_not_a_project_input(self):
        data=json.loads(self.path.read_text());data['game_fit']='src/data/locoFit.json';cli.write(self.path,data)
        with self.assertRaisesRegex(ValueError,'runtime calibration'):cli.load(self.path)

    def test_reference_evidence_must_name_a_picture(self):
        p=self.root/'observations.json';data=json.loads(p.read_text());data['observed'][0]['picture']='not-a-view';cli.write(p,data)
        with self.assertRaisesRegex(ValueError,'Observed details'):cli.load(self.path)

    def test_no_output_can_escape_project(self):
        data=json.loads(self.path.read_text());data['output']='../outside';cli.write(self.path,data)
        with self.assertRaisesRegex(ValueError,'within their project'):cli.load(self.path)

    def test_changed_geometry_invalidates_recipe_lock(self):
        root,data,_=cli.load(self.path);before=cli.fingerprint(self.path,root,data)
        (root/'build.py').write_text('# altered authored proportions\n')
        self.assertNotEqual(before,cli.fingerprint(self.path,root,data))

    def test_uninterpreted_png_cannot_emit_a_guessed_model(self):
        (self.root/'build.py').write_text('UNAUTHORED_RECIPE')
        with self.assertRaisesRegex(ValueError,'picture-authored recipe'):cli.load(self.path)

if __name__=='__main__':unittest.main()

import json
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PLUGIN = ROOT / 'plugins' / 'engineering-workflows'


class PackageTest(unittest.TestCase):
    def test_favorite_workflows_are_discoverable(self):
        for skill, triggers in {
            'technical-writing': ('unslop',),
            'adversarial-review': ('pr-review', 'code review'),
            'task-framing': ('grill-me', 'grill-with-docs'),
        }.items():
            text = (PLUGIN / 'skills' / skill / 'SKILL.md').read_text()
            frontmatter = text.split('---', 2)[1].lower()
            for trigger in triggers:
                with self.subTest(skill=skill, trigger=trigger):
                    self.assertIn(trigger, frontmatter)

    def test_manifests_and_registration(self):
        for kind in ('.codex-plugin', '.augment-plugin', '.claude-plugin'):
            manifest = json.loads((PLUGIN / kind / 'plugin.json').read_text())
            self.assertEqual(manifest['name'], PLUGIN.name)
            self.assertEqual(manifest['version'], '0.1.0')
            self.assertEqual(manifest['skills'], './skills/')
        for path in (ROOT / '.agents/plugins/marketplace.json',
                     ROOT / '.augment-plugin/marketplace.json',
                     ROOT / '.claude-plugin/marketplace.json'):
            entries = json.loads(path.read_text())['plugins']
            self.assertEqual(sum(e['name'] == PLUGIN.name for e in entries), 1)

    def test_copy_discovery_and_collisions(self):
        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp) / PLUGIN.name
            shutil.copytree(PLUGIN, copy)
            skills = sorted((copy / 'skills').glob('*/SKILL.md'))
            self.assertEqual(len(skills), 16)
            other_names = {p.parent.name for p in (ROOT / 'plugins').glob('*/skills/*/SKILL.md')
                           if PLUGIN.name not in p.parts}
            for skill in skills:
                text = skill.read_text()
                self.assertTrue(text.startswith('---\nname: ' + skill.parent.name + '\n'))
                self.assertIn('\ndescription: ', text)
                frontmatter = text.split('---', 2)[1]
                description_line = next(line for line in frontmatter.splitlines()
                                        if line.startswith('description: '))
                self.assertTrue(json.loads(description_line.removeprefix('description: ')))
                self.assertNotIn('disable-model-invocation: true', frontmatter)
                self.assertNotIn(skill.parent.name, other_names)
                self.assertNotIn('../', text)
            for name in ('matt-pocock-MIT.txt', 'pstack-MIT.txt'):
                license_text = (copy / 'licenses' / name).read_text()
                self.assertIn('MIT License', license_text)
                self.assertIn('Permission is hereby granted', license_text)


if __name__ == '__main__':
    unittest.main()

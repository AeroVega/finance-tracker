import json
import shutil
import tempfile
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1]
ROOT = PACKAGE.parent


class PackageTest(unittest.TestCase):
    def test_favorite_workflows_are_discoverable(self):
        for skill, triggers in {
            'technical-writing': ('unslop',),
            'adversarial-review': ('pr-review', 'code review'),
            'task-framing': ('grill-me', 'grill-with-docs'),
        }.items():
            text = (PACKAGE / 'skills' / skill / 'SKILL.md').read_text()
            frontmatter = text.split('---', 2)[1].lower()
            for trigger in triggers:
                with self.subTest(skill=skill, trigger=trigger):
                    self.assertIn(trigger, frontmatter)

    def test_repository_discovery(self):
        self.assertEqual(PACKAGE, ROOT / 'engineering-workflows')
        self.assertFalse((ROOT / 'skills').exists())
        skills = {p.parent.name for p in (PACKAGE / 'skills').glob('*/SKILL.md')}
        discovery = ROOT / '.agents' / 'skills'
        self.assertEqual({p.name for p in discovery.iterdir()}, skills)
        for name in skills:
            link = discovery / name
            with self.subTest(skill=name):
                self.assertTrue(link.is_symlink())
                self.assertEqual(link.readlink(),
                                 Path('../../engineering-workflows/skills') / name)
                self.assertEqual(link.resolve(), PACKAGE / 'skills' / name)

    def test_copy_preserves_self_contained_skills(self):
        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp) / PACKAGE.name
            shutil.copytree(PACKAGE, copy)
            skills = sorted((copy / 'skills').glob('*/SKILL.md'))
            self.assertEqual(len(skills), 16)
            for skill in skills:
                text = skill.read_text()
                self.assertTrue(text.startswith('---\nname: ' + skill.parent.name + '\n'))
                self.assertIn('\ndescription: ', text)
                frontmatter = text.split('---', 2)[1]
                description_line = next(line for line in frontmatter.splitlines()
                                        if line.startswith('description: '))
                self.assertTrue(json.loads(description_line.removeprefix('description: ')))
                self.assertNotIn('disable-model-invocation: true', frontmatter)
                self.assertNotIn('../', text)
            for name in ('matt-pocock-MIT.txt', 'pstack-MIT.txt'):
                license_text = (copy / 'licenses' / name).read_text()
                self.assertIn('MIT License', license_text)
                self.assertIn('Permission is hereby granted', license_text)


if __name__ == '__main__':
    unittest.main()

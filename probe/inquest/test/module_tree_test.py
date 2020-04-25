import os

from ..module_tree import ModuleTree


def test_on_probe_test_module():
    tree = ModuleTree(__file__)
    files = {file.name for file in tree.modules()}
    assert __file__ in files


def test_on_sample_module():
    sample = os.path.join(os.path.dirname(__file__), "sample.py")
    tree = ModuleTree(sample)
    files = {file.name: file for file in tree.modules()}
    assert sample in files
    assert set(func.name for func in files[sample].functions) == {
        'async_sample_with_decorator', 'sample', 'sample_with_decorator',
        'async_sample'
    }

    classes = set(cls.name for cls in files[sample].classes)
    methods = set(
        f'{cls.name}.{met.name}' for cls in files[sample].classes
        for met in cls.methods
    )
    assert classes == {'TestClassWithDecorator', 'TestClass'}
    assert methods == {
        'TestClassWithDecorator.async_sample',
        'TestClassWithDecorator.sample_with_decorator', 'TestClass.sample',
        'TestClass.async_sample', 'TestClassWithDecorator.sample',
        'TestClass.async_sample_with_decorator',
        'TestClassWithDecorator.async_sample_with_decorator',
        'TestClass.sample_with_decorator'
    }

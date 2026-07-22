'use strict';

const {
	extract,
	parseParams,
	extractDocstring,
	parseDocstring,
	buildContent,
	extractKeywords
} = require('../../../lib/extractors/python');

describe('Python Extractor', () => {

	const context = { org: '63klabs', repo: 'tools' };

	describe('extractKeywords', () => {
		it('extracts meaningful words and removes stop words', () => {
			const keywords = extractKeywords('Parse the user config data');
			expect(keywords).toContain('parse');
			expect(keywords).toContain('user');
			expect(keywords).toContain('config');
			expect(keywords).not.toContain('the');
		});

		it('splits on underscores', () => {
			const keywords = extractKeywords('user_name');
			expect(keywords).toContain('user');
			expect(keywords).toContain('name');
		});

		it('deduplicates keywords', () => {
			const keywords = extractKeywords('parse parse parse');
			expect(keywords).toEqual(['parse']);
		});

		it('returns empty array for stop-words-only text', () => {
			expect(extractKeywords('the a an')).toHaveLength(0);
		});

		it('filters out Python-specific stop words', () => {
			const keywords = extractKeywords('self cls none return');
			expect(keywords).toHaveLength(0);
		});
	});

	describe('parseParams', () => {
		it('parses simple parameters', () => {
			const params = parseParams('name, age');
			expect(params).toHaveLength(2);
			expect(params[0]).toEqual({ name: 'name', type: '' });
			expect(params[1]).toEqual({ name: 'age', type: '' });
		});

		it('parses type-annotated parameters', () => {
			const params = parseParams('name: str, age: int');
			expect(params).toHaveLength(2);
			expect(params[0]).toEqual({ name: 'name', type: 'str' });
			expect(params[1]).toEqual({ name: 'age', type: 'int' });
		});

		it('strips default values', () => {
			const params = parseParams('name: str = "world", count: int = 0');
			expect(params).toHaveLength(2);
			expect(params[0].name).toBe('name');
			expect(params[1].name).toBe('count');
		});

		it('skips self and cls', () => {
			const params = parseParams('self, name: str');
			expect(params).toHaveLength(1);
			expect(params[0].name).toBe('name');
		});

		it('handles *args and **kwargs', () => {
			const params = parseParams('*args, **kwargs');
			expect(params).toHaveLength(2);
			expect(params[0].name).toBe('args');
			expect(params[1].name).toBe('kwargs');
		});

		it('returns empty array for empty string', () => {
			expect(parseParams('')).toHaveLength(0);
		});

		it('returns empty array for null', () => {
			expect(parseParams(null)).toHaveLength(0);
		});
	});


	describe('extractDocstring', () => {
		it('extracts single-line docstring with double quotes', () => {
			const lines = ['    """Does stuff."""'];
			const result = extractDocstring(lines, 0, 4);
			expect(result).not.toBeNull();
			expect(result.raw).toBe('Does stuff.');
			expect(result.endLine).toBe(0);
		});

		it('extracts single-line docstring with single quotes', () => {
			const lines = ["    '''Does stuff.'''"];
			const result = extractDocstring(lines, 0, 4);
			expect(result).not.toBeNull();
			expect(result.raw).toBe('Does stuff.');
		});

		it('extracts multi-line docstring', () => {
			const lines = [
				'    """',
				'    Does stuff.',
				'',
				'    More details.',
				'    """'
			];
			const result = extractDocstring(lines, 0, 4);
			expect(result).not.toBeNull();
			expect(result.raw).toContain('Does stuff.');
			expect(result.raw).toContain('More details.');
			expect(result.endLine).toBe(4);
		});

		it('skips blank lines before docstring', () => {
			const lines = ['', '    """Does stuff."""'];
			const result = extractDocstring(lines, 0, 4);
			expect(result).not.toBeNull();
			expect(result.raw).toBe('Does stuff.');
		});

		it('returns null when no docstring present', () => {
			const lines = ['    x = 1'];
			const result = extractDocstring(lines, 0, 4);
			expect(result).toBeNull();
		});

		it('returns null for empty lines array', () => {
			const result = extractDocstring([], 0, 4);
			expect(result).toBeNull();
		});

		it('returns null when startLine is beyond array', () => {
			const result = extractDocstring(['line'], 5, 4);
			expect(result).toBeNull();
		});
	});

	describe('parseDocstring', () => {
		it('extracts description only', () => {
			const result = parseDocstring('Calculate the total price.');
			expect(result.description).toBe('Calculate the total price.');
			expect(result.args).toHaveLength(0);
			expect(result.returns).toBeNull();
			expect(result.raises).toBeNull();
		});

		it('extracts description and Args section', () => {
			const raw = [
				'Calculate total.',
				'',
				'Args:',
				'    price (float): Base price.',
				'    tax_rate (float): Tax rate.'
			].join('\n');
			const result = parseDocstring(raw);
			expect(result.description).toBe('Calculate total.');
			expect(result.args).toHaveLength(2);
			expect(result.args[0]).toEqual({ name: 'price', type: 'float', description: 'Base price.' });
			expect(result.args[1]).toEqual({ name: 'tax_rate', type: 'float', description: 'Tax rate.' });
		});

		it('extracts Args without type annotation', () => {
			const raw = [
				'Do stuff.',
				'',
				'Args:',
				'    name: The name.'
			].join('\n');
			const result = parseDocstring(raw);
			expect(result.args).toHaveLength(1);
			expect(result.args[0]).toEqual({ name: 'name', type: '', description: 'The name.' });
		});

		it('extracts Returns section', () => {
			const raw = [
				'Check validity.',
				'',
				'Returns:',
				'    bool: True if valid.'
			].join('\n');
			const result = parseDocstring(raw);
			expect(result.returns).toBe('bool: True if valid.');
		});

		it('extracts Raises section', () => {
			const raw = [
				'Process data.',
				'',
				'Raises:',
				'    ValueError: If data is invalid.'
			].join('\n');
			const result = parseDocstring(raw);
			expect(result.raises).toBe('ValueError: If data is invalid.');
		});

		it('extracts all sections together', () => {
			const raw = [
				'Process user data.',
				'',
				'Args:',
				'    data (dict): Input data.',
				'',
				'Returns:',
				'    dict: Processed data.',
				'',
				'Raises:',
				'    ValueError: If data is empty.'
			].join('\n');
			const result = parseDocstring(raw);
			expect(result.description).toBe('Process user data.');
			expect(result.args).toHaveLength(1);
			expect(result.returns).toBe('dict: Processed data.');
			expect(result.raises).toBe('ValueError: If data is empty.');
		});

		it('handles empty raw string', () => {
			const result = parseDocstring('');
			expect(result.description).toBe('');
			expect(result.args).toHaveLength(0);
		});

		it('handles null raw string', () => {
			const result = parseDocstring(null);
			expect(result.description).toBe('');
		});

		it('handles Arguments: as alias for Args:', () => {
			const raw = [
				'Do stuff.',
				'',
				'Arguments:',
				'    x (int): The value.'
			].join('\n');
			const result = parseDocstring(raw);
			expect(result.args).toHaveLength(1);
			expect(result.args[0].name).toBe('x');
		});

		it('handles multi-line arg descriptions', () => {
			const raw = [
				'Do stuff.',
				'',
				'Args:',
				'    data (dict): The input data',
				'        that spans multiple lines.'
			].join('\n');
			const result = parseDocstring(raw);
			expect(result.args).toHaveLength(1);
			expect(result.args[0].description).toContain('input data');
			expect(result.args[0].description).toContain('multiple lines');
		});
	});


	describe('buildContent', () => {
		it('combines signature, description, args, returns, and raises', () => {
			const docstring = {
				description: 'Check validity.',
				args: [{ name: 'x', type: 'int', description: 'The value' }],
				returns: 'bool: True if valid.',
				raises: 'ValueError: If x is negative.'
			};
			const result = buildContent('def check(x: int) -> bool:', docstring);
			expect(result).toContain('def check(x: int) -> bool:');
			expect(result).toContain('Check validity.');
			expect(result).toContain('Args:');
			expect(result).toContain('    x (int): The value');
			expect(result).toContain('Returns:');
			expect(result).toContain('    bool: True if valid.');
			expect(result).toContain('Raises:');
			expect(result).toContain('    ValueError: If x is negative.');
		});

		it('omits sections when null', () => {
			const docstring = {
				description: 'Simple function.',
				args: [],
				returns: null,
				raises: null
			};
			const result = buildContent('def simple():', docstring);
			expect(result).toContain('def simple():');
			expect(result).toContain('Simple function.');
			expect(result).not.toContain('Args:');
			expect(result).not.toContain('Returns:');
			expect(result).not.toContain('Raises:');
		});
	});

	describe('extract', () => {
		it('extracts a standard function with docstring', () => {
			const code = [
				'def greet(name):',
				'    """Say hello to someone."""',
				'    print(f"Hello, {name}")'
			].join('\n');

			const entries = extract(code, 'utils.py', context);
			expect(entries).toHaveLength(1);
			expect(entries[0].contentPath).toBe('63klabs/tools/utils.py/greet');
			expect(entries[0].title).toBe('greet');
			expect(entries[0].type).toBe('code-example');
			expect(entries[0].subType).toBe('function');
			expect(entries[0].keywords.length).toBeGreaterThan(0);
		});

		it('extracts an async function', () => {
			const code = [
				'async def fetch_data(url: str) -> dict:',
				'    """Fetch data from URL."""',
				'    pass'
			].join('\n');

			const entries = extract(code, 'api.py', context);
			expect(entries).toHaveLength(1);
			expect(entries[0].title).toBe('fetch_data');
			expect(entries[0].content).toContain('async def fetch_data');
		});

		it('extracts function with type annotations', () => {
			const code = [
				'def calculate(price: float, tax: float) -> float:',
				'    """Calculate total with tax."""',
				'    return price * (1 + tax)'
			].join('\n');

			const entries = extract(code, 'calc.py', context);
			expect(entries).toHaveLength(1);
			expect(entries[0].content).toContain('-> float');
		});

		it('extracts class methods with class name in content path', () => {
			const code = [
				'class UserService:',
				'    def get_user(self, user_id: str) -> dict:',
				'        """Get user by ID."""',
				'        return {}'
			].join('\n');

			const entries = extract(code, 'service.py', context);
			expect(entries).toHaveLength(1);
			expect(entries[0].contentPath).toBe('63klabs/tools/service.py/UserService/get_user');
			expect(entries[0].title).toBe('UserService.get_user');
		});

		it('extracts multiple methods from a class', () => {
			const code = [
				'class Deployer:',
				'    def run(self):',
				'        """Run the deployment."""',
				'        pass',
				'',
				'    def rollback(self):',
				'        """Rollback the deployment."""',
				'        pass'
			].join('\n');

			const entries = extract(code, 'deploy.py', context);
			expect(entries).toHaveLength(2);
			expect(entries[0].title).toBe('Deployer.run');
			expect(entries[1].title).toBe('Deployer.rollback');
		});

		it('extracts top-level function after a class', () => {
			const code = [
				'class Foo:',
				'    def bar(self):',
				'        """Bar method."""',
				'        pass',
				'',
				'def standalone():',
				'    """A standalone function."""',
				'    pass'
			].join('\n');

			const entries = extract(code, 'module.py', context);
			expect(entries).toHaveLength(2);
			expect(entries[0].contentPath).toContain('Foo/bar');
			expect(entries[1].contentPath).toBe('63klabs/tools/module.py/standalone');
			expect(entries[1].title).toBe('standalone');
		});

		it('extracts function with full Google-style docstring', () => {
			const code = [
				'def process(data: dict, validate: bool = True) -> dict:',
				'    """Process input data.',
				'',
				'    Args:',
				'        data (dict): The input data.',
				'        validate (bool): Whether to validate.',
				'',
				'    Returns:',
				'        dict: Processed result.',
				'',
				'    Raises:',
				'        ValueError: If data is empty.',
				'    """',
				'    pass'
			].join('\n');

			const entries = extract(code, 'processor.py', context);
			expect(entries).toHaveLength(1);
			expect(entries[0].content).toContain('Args:');
			expect(entries[0].content).toContain('data (dict): The input data.');
			expect(entries[0].content).toContain('Returns:');
			expect(entries[0].content).toContain('Raises:');
		});

		it('skips functions without docstrings', () => {
			const code = [
				'def no_doc(x):',
				'    return x * 2'
			].join('\n');

			const entries = extract(code, 'utils.py', context);
			expect(entries).toHaveLength(0);
		});

		it('skips functions with empty docstrings', () => {
			const code = [
				'def empty_doc(x):',
				'    """"""',
				'    return x'
			].join('\n');

			const entries = extract(code, 'utils.py', context);
			expect(entries).toHaveLength(0);
		});

		it('skips dunder methods except __init__', () => {
			const code = [
				'class Foo:',
				'    def __repr__(self):',
				'        """String representation."""',
				'        return "Foo"',
				'',
				'    def __init__(self, name):',
				'        """Initialize Foo."""',
				'        self.name = name'
			].join('\n');

			const entries = extract(code, 'foo.py', context);
			expect(entries).toHaveLength(1);
			expect(entries[0].title).toBe('Foo.__init__');
		});

		it('extracts keywords from function name and params', () => {
			const code = [
				'def process_user_data(user_name: str, user_id: int):',
				'    """Process user data for validation."""',
				'    pass'
			].join('\n');

			const entries = extract(code, 'utils.py', context);
			expect(entries[0].keywords).toContain('process');
			expect(entries[0].keywords).toContain('user');
			expect(entries[0].keywords).toContain('data');
			expect(entries[0].keywords).toContain('validation');
		});

		it('limits excerpt to 200 characters', () => {
			const longDesc = 'A'.repeat(250) + ' long description.';
			const code = [
				'def long_func(x):',
				`    """${longDesc}"""`,
				'    pass'
			].join('\n');

			const entries = extract(code, 'utils.py', context);
			expect(entries[0].excerpt.length).toBeLessThanOrEqual(200);
		});

		it('returns empty array for empty content', () => {
			expect(extract('', 'utils.py', context)).toEqual([]);
		});

		it('returns empty array for null content', () => {
			expect(extract(null, 'utils.py', context)).toEqual([]);
		});

		it('returns empty array for non-string content', () => {
			expect(extract(42, 'utils.py', context)).toEqual([]);
		});

		it('returns empty array for code with no functions', () => {
			const code = 'x = 42\ny = "hello"';
			expect(extract(code, 'utils.py', context)).toEqual([]);
		});

		it('handles single-quote docstrings', () => {
			const code = [
				"def greet(name):",
				"    '''Say hello.'''",
				"    pass"
			].join('\n');

			const entries = extract(code, 'utils.py', context);
			expect(entries).toHaveLength(1);
			expect(entries[0].title).toBe('greet');
		});

		it('handles nested file paths', () => {
			const code = [
				'def deep_func(x):',
				'    """Deep nested function."""',
				'    pass'
			].join('\n');

			const entries = extract(code, 'src/lib/deep/module.py', context);
			expect(entries[0].contentPath).toBe('63klabs/tools/src/lib/deep/module.py/deep_func');
		});

		it('extracts multiple top-level functions', () => {
			const code = [
				'def first(a):',
				'    """First function."""',
				'    pass',
				'',
				'def second(b):',
				'    """Second function."""',
				'    pass'
			].join('\n');

			const entries = extract(code, 'utils.py', context);
			expect(entries).toHaveLength(2);
			expect(entries[0].title).toBe('first');
			expect(entries[1].title).toBe('second');
		});
	});
});

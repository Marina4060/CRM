"""Tiny JavaScript lexer: finds string literals, template literals, comments
and regex literals so text inside them can be rewritten safely.

Only as clever as the CRM file needs: it is not a full JS parser.
"""

REGEX_PREV = set('(,=:[!&|?{};+-*%<>~^')
REGEX_KW = ('return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do')


def spans(src, start=0, end=None):
    """Yield (kind, a, b, quote) for each literal/comment in src[start:end].

    kind is 'str' (quote is ' or "), 'tpl' (template text chunk, quote `),
    'line' / 'block' comment, or 'regex'. Offsets are absolute.
    """
    if end is None:
        end = len(src)
    i = start
    last_sig = ''          # last significant code char, for regex detection
    last_word = ''
    tpl_stack = []         # brace depth for each open ${ ... }
    depth = 0
    while i < end:
        ch = src[i]
        if tpl_stack and ch == '}' and depth == tpl_stack[-1]:
            tpl_stack.pop()
            # back inside the template text
            i = yield_tpl = i + 1
            j = _scan_tpl(src, i, end)
            yield ('tpl', i, j[0], '`')
            if j[1] == '${':
                tpl_stack.append(depth)
                i = j[0] + 2
            else:
                i = j[0] + 1
            last_sig = 'x'
            continue
        if ch in '\'"':
            j = i + 1
            while j < end and src[j] != ch:
                if src[j] == '\\':
                    j += 1
                elif src[j] == '\n':
                    break
                j += 1
            yield ('str', i + 1, j, ch)
            i = j + 1
            last_sig = 'x'
            last_word = ''
            continue
        if ch == '`':
            j = _scan_tpl(src, i + 1, end)
            yield ('tpl', i + 1, j[0], '`')
            if j[1] == '${':
                tpl_stack.append(depth)
                i = j[0] + 2
            else:
                i = j[0] + 1
            last_sig = 'x'
            continue
        if ch == '/' and i + 1 < end and src[i + 1] == '/':
            j = src.find('\n', i)
            j = end if j < 0 or j > end else j
            yield ('line', i + 2, j, '')
            i = j
            continue
        if ch == '/' and i + 1 < end and src[i + 1] == '*':
            j = src.find('*/', i + 2)
            j = end if j < 0 else j
            yield ('block', i + 2, j, '')
            i = j + 2
            continue
        if ch == '/' and (last_sig == '' or last_sig in REGEX_PREV or last_word in REGEX_KW):
            j = i + 1
            in_cls = False
            while j < end:
                c = src[j]
                if c == '\\':
                    j += 2
                    continue
                if c == '\n':
                    break
                if in_cls:
                    if c == ']':
                        in_cls = False
                elif c == '[':
                    in_cls = True
                elif c == '/':
                    break
                j += 1
            yield ('regex', i + 1, j, '/')
            i = j + 1
            while i < end and src[i].isalpha():
                i += 1
            last_sig = 'x'
            continue
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
        if not ch.isspace():
            if ch.isalnum() or ch in '_$':
                j = i
                while j < end and (src[j].isalnum() or src[j] in '_$'):
                    j += 1
                last_word = src[i:j]
                last_sig = 'x'
                i = j
                continue
            last_sig = ch
            last_word = ''
        i += 1


def _scan_tpl(src, i, end):
    while i < end:
        c = src[i]
        if c == '\\':
            i += 2
            continue
        if c == '`':
            return (i, '`')
        if c == '$' and i + 1 < end and src[i + 1] == '{':
            return (i, '${')
        i += 1
    return (end, '')

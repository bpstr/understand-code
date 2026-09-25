from handlers import LiveHandler

HANDLERS = {'checkout': LiveHandler}

def build(name):
    return HANDLERS[name]()

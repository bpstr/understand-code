from config import TAX_RATE

def total(net):
    return net * (1 + TAX_RATE)

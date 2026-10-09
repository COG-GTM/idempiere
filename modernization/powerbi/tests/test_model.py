from r2r.model_check import check


def test_power_bi_project_references_resolve():
    assert check() == []

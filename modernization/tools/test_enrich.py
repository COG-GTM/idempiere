"""Offline tests for the enrichment tooling (no network / creds needed)."""

import enrich_context as ec
import journey_data


def test_profile_known_journey():
    prof = journey_data.profile_journey("order-to-cash")
    assert prof["found"] is True
    assert prof["total_rows"] > 0
    assert any(t["table"] == "C_Invoice" for t in prof["tables"])


def test_profile_unknown_journey():
    assert journey_data.profile_journey("nope")["found"] is False


def test_downstream_registry_loads():
    ds = ec.fetch_downstream_impact("order-to-cash")
    assert ds["available"] and ds["found"]
    assert ds["downstream_consumers"]


def test_render_report_offline():
    j = "order-to-cash"
    report = ec.render_report(
        j,
        {"available": False, "reason": "no token"},
        {"available": False, "reason": "no token"},
        ec.fetch_data_profile(j),
        ec.fetch_downstream_impact(j),
    )
    assert "Context enrichment" in report
    assert "Order-to-Cash core" in report
    assert "C_Invoice" in report

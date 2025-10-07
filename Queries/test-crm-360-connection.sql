SELECT
    b.entry_id AS buyer_internal_id,
    b.api_buyer_id,
    b.name AS buyer_name,
    b.website_url,
    b.source AS buyer_source,

    --data from "lookup" tables (a buyer has one stage and one deal flow)
    s.name AS stage_name,
    s.color AS stage_color,
    df.name AS deal_flow_name,

    --data from "child" tables, aggregated into clean JSON arrays
    (SELECT JSON_AGG(
                    JSON_BUILD_OBJECT(
                            'name', c.name,
                            'email', c.email,
                            'title', c.title,
                            'phone', c.primary_phone
                    ) ORDER BY c.entry_id
            ) FROM "ORDERS-buyer_contacts" AS c WHERE c.orders_buyer_id = b.entry_id) AS contacts,

    (SELECT JSON_AGG(
                    JSON_BUILD_OBJECT(
                            'name', l.name,
                            'address', CONCAT(l.line_one, ', ', l.city, ', ', l.state, ' ', l.zip),
                            'type', l.type
                    ) ORDER BY l.entry_id
            ) FROM "ORDERS-buyer_locations" AS l WHERE l.orders_buyer_id = b.entry_id) AS locations,

    (SELECT JSON_AGG(
                    JSON_BUILD_OBJECT(
                            'title', n.title,
                            'text', n.text,
                            'created_at', n.created_at
                    ) ORDER BY n.created_at DESC
            ) FROM "ORDERS-buyer_notes" AS n WHERE n.orders_buyer_id = b.entry_id) AS notes,

    (SELECT JSON_AGG(
                    JSON_BUILD_OBJECT(
                            'name', sr.name,
                            'email', sr.email,
                            'phone', sr.phone
                    ) ORDER BY sr.name
            ) FROM "ORDERS-buyer_sales_reps_assignments" AS sr WHERE sr.orders_buyer_id = b.entry_id) AS sales_reps,

    (SELECT JSON_AGG(
                    JSON_BUILD_OBJECT(
                            'name', t.name,
                            'color', t.color
                    ) ORDER BY t.name
            ) FROM "ORDERS-buyer_tags" AS t WHERE t.orders_buyer_id = b.entry_id) AS tags

FROM
    "ORDERS-buyers" AS b
        LEFT JOIN
    "ORDERS-buyer_stages" AS s ON b.fk_stage_id = s.entry_id
        LEFT JOIN
    "ORDERS-deal_flows" AS df ON b.fk_deal_flow_id = df.entry_id
WHERE
    b.api_buyer_id = 144982; --you can change this ID to search for any other buyer
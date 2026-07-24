-- ClickUpTasks — seeds the 60 default theme-calendar entries (5 per month),
-- ported verbatim from WordPress's cul_sales_theme_calendar_default()
-- (sales-tool.php). Run once, after planner.sql. Idempotent — re-running
-- adds nothing if a (month, week_of_month) row already exists, so a
-- since-edited title/category list is never clobbered by a re-run.

insert into planner_theme_calendar (month, week_of_month, title, categories) values
  (1, 1, 'New year, new local discoveries', '["Restaurants","Fitness and Gyms","Beauty and Spa","Retail Shops"]'),
  (1, 2, 'Winter warm-ups', '["Coffee and Cafes","Restaurants","Bakeries","Bars and Pubs"]'),
  (1, 3, 'Valentine''s prep', '["Florists","Jewelry","Restaurants","Gift Shops"]'),
  (1, 4, 'Hidden gems', '["Specialty Retail","Coffee and Cafes","Art and Galleries","Local Makers"]'),
  (1, 5, 'Tax season survival', '["Accounting and Tax","Financial Services","Legal Services","Business Services"]'),

  (2, 1, 'Valentine''s Day', '["Restaurants","Florists","Jewelry","Chocolatiers and Sweets"]'),
  (2, 2, 'Presidents Day weekend', '["Restaurants","Entertainment","Retail Shops","Outdoor and Recreation"]'),
  (2, 3, 'Spring is coming', '["Garden and Nursery","Home Services","Landscaping","Cleaning Services"]'),
  (2, 4, 'Self-care season', '["Spa and Wellness","Salons","Massage","Fitness and Gyms"]'),
  (2, 5, 'Cozy comfort food', '["Restaurants","Cafes","Bakeries","Bars and Pubs"]'),

  (3, 1, 'Spring cleaning', '["Cleaning Services","Home Services","Junk Removal","Organization and Storage"]'),
  (3, 2, 'St. Patrick''s Day', '["Bars and Pubs","Breweries","Restaurants","Live Music Venues"]'),
  (3, 3, 'First days of spring', '["Garden and Nursery","Patios and Outdoor Dining","Cafes","Florists"]'),
  (3, 4, 'Farmers market season kickoff', '["Farmers Markets","Specialty Food","Bakeries","Local Makers"]'),
  (3, 5, 'Fresh starts and new menus', '["Restaurants","Cafes","Fitness and Gyms","Wellness"]'),

  (4, 1, 'Easter and spring gatherings', '["Bakeries","Florists","Restaurants","Catering"]'),
  (4, 2, 'Spring flavors', '["Restaurants","Cafes","Specialty Food","Wineries"]'),
  (4, 3, 'Earth Day', '["Eco and Sustainable","Garden and Nursery","Thrift and Resale","Local Makers"]'),
  (4, 4, 'Pet lovers guide', '["Pet Grooming","Veterinary","Pet Supplies","Dog Daycare and Boarding"]'),
  (4, 5, 'Family day out', '["Entertainment","Parks and Recreation","Ice Cream and Treats","Kids Activities"]'),

  (5, 1, 'Mother''s Day', '["Florists","Spa and Wellness","Jewelry","Restaurants"]'),
  (5, 2, 'Graduation season', '["Restaurants","Gift Shops","Photography","Catering"]'),
  (5, 3, 'Memorial Day weekend', '["Restaurants","Outdoor and Recreation","Bars and Pubs","Retail Shops"]'),
  (5, 4, 'Summer is coming', '["Ice Cream and Treats","Outdoor and Recreation","Cafes","Fitness and Gyms"]'),
  (5, 5, 'Hidden gems', '["Specialty Retail","Coffee and Cafes","Art and Galleries","Local Makers"]'),

  (6, 1, 'Foodie favorites', '["Restaurants","Food Trucks","Specialty Food","Bakeries"]'),
  (6, 2, 'Father''s Day', '["Restaurants","Breweries","Barbershops","Outdoor and Recreation"]'),
  (6, 3, 'First day of summer', '["Ice Cream and Treats","Cafes","Bars and Pubs","Patios and Outdoor Dining"]'),
  (6, 4, 'Date night ideas', '["Restaurants","Wineries","Entertainment","Live Music Venues"]'),
  (6, 5, 'Pet lovers guide', '["Pet Grooming","Veterinary","Pet Supplies","Dog Daycare and Boarding"]'),

  (7, 1, 'Independence Day', '["Restaurants","Bakeries","Outdoor and Recreation","Retail Shops"]'),
  (7, 2, 'Summer staycation guide', '["Hotels and Lodging","Entertainment","Outdoor and Recreation","Spa and Wellness"]'),
  (7, 3, 'Beat the heat', '["Ice Cream and Treats","Cafes","Entertainment","Indoor Recreation"]'),
  (7, 4, 'Small business spotlight', '["Retail Shops","Restaurants","Local Makers","Service Businesses"]'),
  (7, 5, 'Behind the counter', '["Coffee and Cafes","Specialty Retail","Bakeries","Local Makers"]'),

  (8, 1, 'Back to school prep', '["Retail Shops","Tutoring and Education","Salons","Sporting Goods"]'),
  (8, 2, 'End of summer bucket list', '["Outdoor and Recreation","Ice Cream and Treats","Entertainment","Restaurants"]'),
  (8, 3, 'Support local', '["Retail Shops","Restaurants","Local Makers","Service Businesses"]'),
  (8, 4, 'Newly claimed listings', '["Mixed Categories"]'),
  (8, 5, 'Self-care season', '["Spa and Wellness","Salons","Massage","Fitness and Gyms"]'),

  (9, 1, 'Labor Day weekend', '["Restaurants","Bars and Pubs","Outdoor and Recreation","Retail Shops"]'),
  (9, 2, 'First days of fall', '["Cafes","Bakeries","Home Services","Garden and Nursery"]'),
  (9, 3, 'Fall flavors', '["Restaurants","Cafes","Bakeries","Wineries"]'),
  (9, 4, 'Home for the season', '["Home Services","HVAC","Landscaping","Handyman Services"]'),
  (9, 5, 'Small business spotlight', '["Retail Shops","Restaurants","Local Makers","Service Businesses"]'),

  (10, 1, 'Rainy day plans', '["Entertainment","Cafes","Indoor Recreation","Art and Galleries"]'),
  (10, 2, 'Daylight saving prep', '["Home Services","Lighting and Electrical","Cafes","Wellness"]'),
  (10, 3, 'Fall gatherings', '["Restaurants","Catering","Bakeries","Florists"]'),
  (10, 4, 'Halloween', '["Bakeries","Costume and Party","Ice Cream and Treats","Entertainment"]'),
  (10, 5, 'Cozy season', '["Coffee and Cafes","Restaurants","Bakeries","Bars and Pubs"]'),

  (11, 1, 'Veterans Day', '["Restaurants","Retail Shops","Service Businesses","Barbershops"]'),
  (11, 2, 'Gratitude season', '["Restaurants","Local Makers","Nonprofits","Retail Shops"]'),
  (11, 3, 'Thanksgiving prep', '["Bakeries","Catering","Grocers and Markets","Florists"]'),
  (11, 4, 'Small Business Saturday', '["Retail Shops","Local Makers","Specialty Food","Gift Shops"]'),
  (11, 5, 'Holiday kickoff', '["Retail Shops","Gift Shops","Jewelry","Local Makers"]'),

  (12, 1, 'Holiday shopping kickoff', '["Retail Shops","Gift Shops","Jewelry","Local Makers"]'),
  (12, 2, 'Holiday dining', '["Restaurants","Bakeries","Catering","Bars and Pubs"]'),
  (12, 3, 'Last-minute gift guide', '["Gift Shops","Retail Shops","Spa and Wellness","Specialty Food"]'),
  (12, 4, 'Festive celebrations', '["Restaurants","Bars and Pubs","Entertainment","Catering"]'),
  (12, 5, 'Year in review', '["Mixed Categories"]')
on conflict (month, week_of_month) do nothing;

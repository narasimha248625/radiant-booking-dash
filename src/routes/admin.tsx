import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getAdminData, addVenueAdmin, removeVenueAdmin, updateVenueAdmin, addSlotAdmin, removeSlotAdmin } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import heroImage from "@/assets/turf-hero.jpg";

export const Route = createFileRoute("/admin")({
  component: AdminPanel,
  loader: async () => {
    return await getAdminData();
  },
});

function AdminPanel() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  
  const { venues, bookings, slots } = Route.useLoaderData();
  const router = useRouter();
  const addVenueFn = useServerFn(addVenueAdmin);
  const removeVenueFn = useServerFn(removeVenueAdmin);
  const updateVenueFn = useServerFn(updateVenueAdmin);
  const addSlotFn = useServerFn(addSlotAdmin);
  const removeSlotFn = useServerFn(removeSlotAdmin);
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSlotLoading, setIsSlotLoading] = useState(false);
  const [newSlot, setNewSlot] = useState({
    venue_id: "",
    slot_date: "",
    start_time: "",
    duration_minutes: 60,
    court_label: "",
    capacity: 1,
  });
  const [newVenue, setNewVenue] = useState({
    name: "",
    location: "",
    description: "",
    price_per_hour: 0,
  });

  useEffect(() => {
    const auth = sessionStorage.getItem("adminAuth");
    if (auth === "true") setIsAuthenticated(true);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    const channel = supabase
      .channel("admin-bookings")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bookings",
        },
        (payload) => {
          console.log("Realtime booking event:", payload);
          if (payload.eventType === "INSERT") {
            toast.success("New booking received!");
          }
          router.invalidate();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAuthenticated, router]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (email === "admin@admin.com" && password === "password") {
      setIsAuthenticated(true);
      sessionStorage.setItem("adminAuth", "true");
      toast.success("Logged in successfully");
    } else {
      toast.error("Invalid credentials");
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    sessionStorage.removeItem("adminAuth");
    toast.success("Logged out");
  };

  const handleAddOrUpdateVenue = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      if (editingId) {
        const result = await updateVenueFn({ data: { id: editingId, ...newVenue, price_per_hour: Number(newVenue.price_per_hour) } });
        if (result.success) {
          toast.success("Turf updated successfully");
          setNewVenue({ name: "", location: "", description: "", price_per_hour: 0 });
          setEditingId(null);
          router.invalidate(); // Refresh data
        } else {
          toast.error(result.error || "Failed to update Turf. Did you add SUPABASE_SERVICE_ROLE_KEY?");
        }
      } else {
        const result = await addVenueFn({ data: { ...newVenue, price_per_hour: Number(newVenue.price_per_hour) } });
        if (result.success) {
          toast.success("Turf added successfully");
          setNewVenue({ name: "", location: "", description: "", price_per_hour: 0 });
          router.invalidate(); // Refresh data
        } else {
          toast.error(result.error || "Failed to add Turf. Did you add SUPABASE_SERVICE_ROLE_KEY?");
        }
      }
    } catch (err: any) {
      toast.error(err.message || "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditClick = (venue: any) => {
    setEditingId(venue.id);
    setNewVenue({
      name: venue.name,
      location: venue.location,
      description: venue.description,
      price_per_hour: venue.price_per_hour,
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setNewVenue({ name: "", location: "", description: "", price_per_hour: 0 });
  };

  const handleAddSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSlotLoading(true);
    try {
      const result = await addSlotFn({ data: { 
        ...newSlot,
        duration_minutes: Number(newSlot.duration_minutes),
        capacity: Number(newSlot.capacity)
      } });
      if (result.success) {
        toast.success("Slot added successfully");
        setNewSlot({ ...newSlot, court_label: "", start_time: "" }); 
        router.invalidate();
      } else {
        toast.error(result.error || "Failed to add slot");
      }
    } catch (err: any) {
      toast.error(err.message || "An error occurred");
    } finally {
      setIsSlotLoading(false);
    }
  };

  const handleRemoveSlot = async (id: string) => {
    if (!window.confirm("Are you sure you want to remove this slot?")) return;
    try {
      const result = await removeSlotFn({ data: { id } });
      if (result.success) {
        toast.success("Slot removed successfully");
        router.invalidate();
      } else {
        toast.error(result.error || "Failed to remove slot");
      }
    } catch (err: any) {
      toast.error(err.message || "An error occurred");
    }
  };

  const handleRemoveVenue = async (id: string) => {
    if (!window.confirm("Are you sure you want to remove this turf? This might affect existing bookings.")) return;
    
    try {
      const result = await removeVenueFn({ data: { id } });
      if (result.success) {
        toast.success("Turf removed successfully");
        if (editingId === id) handleCancelEdit();
        router.invalidate();
      } else {
        toast.error(result.error || "Failed to remove Turf. Did you add SUPABASE_SERVICE_ROLE_KEY?");
      }
    } catch (err: any) {
      toast.error(err.message || "An error occurred");
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-hero flex items-center justify-center p-4">
        <img
          src={heroImage}
          alt="Hero Background"
          className="absolute inset-0 h-full w-full object-cover object-[64%_center]"
        />
        <div className="hero-scrim absolute inset-0" />
        <div className="relative z-10 w-full max-w-md">
          <Card className="bg-zinc-900/90 backdrop-blur-md border-zinc-800 text-white shadow-2xl">
            <CardHeader>
              <CardTitle className="text-2xl font-bold">Admin Login</CardTitle>
              <CardDescription className="text-zinc-400">Enter your credentials to access the admin panel.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-zinc-800/80 border-zinc-700 text-white"
                    placeholder="admin@admin.com"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-zinc-800/80 border-zinc-700 text-white"
                    placeholder="••••••••"
                    required
                  />
                </div>
                <Button type="submit" className="w-full bg-[#00D084] hover:bg-[#00D084]/90 text-black font-semibold">
                  Login
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen overflow-hidden bg-hero text-white p-6 flex flex-col">
      <img
        src={heroImage}
        alt="Hero Background"
        className="absolute inset-0 h-full w-full object-cover object-[64%_center]"
      />
      <div className="hero-scrim absolute inset-0" />
      <div className="relative z-10 w-full max-w-6xl mx-auto flex-1 flex flex-col min-h-0 space-y-4">
        <div className="flex justify-between items-center shrink-0">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white drop-shadow-md">Admin Dashboard</h1>
            <p className="text-zinc-300 mt-1 drop-shadow-md">Manage turfs, bookings, and users.</p>
          </div>
          <Button variant="outline" onClick={handleLogout} className="border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-800">
            Logout
          </Button>
        </div>

        <Tabs defaultValue="bookings" className="w-full flex-1 flex flex-col min-h-0">
          <TabsList className="bg-zinc-900 border border-zinc-800 mb-4 shrink-0">
            <TabsTrigger value="bookings" className="data-[state=active]:bg-zinc-800 data-[state=active]:text-white">Bookings & Users</TabsTrigger>
            <TabsTrigger value="turfs" className="data-[state=active]:bg-zinc-800 data-[state=active]:text-white">Turfs (Pitches)</TabsTrigger>
            <TabsTrigger value="slots" className="data-[state=active]:bg-zinc-800 data-[state=active]:text-white">Slots</TabsTrigger>
          </TabsList>
          
          <TabsContent value="bookings" className="space-y-4 mt-0">
            <Card className="bg-zinc-900/90 backdrop-blur-md border-zinc-800 shadow-xl">
              <CardHeader>
                <CardTitle className="text-white">Recent Bookings</CardTitle>
                <CardDescription className="text-zinc-400">List of users who booked slots on the platform.</CardDescription>
              </CardHeader>
              <CardContent>
                {bookings.length > 0 ? (
                  <div className="rounded-md border border-zinc-800 overflow-y-auto max-h-[600px]">
                    <Table>
                      <TableHeader className="bg-zinc-950 sticky top-0 z-10">
                        <TableRow className="border-zinc-800 hover:bg-zinc-950/50">
                          <TableHead className="text-zinc-400">Code</TableHead>
                          <TableHead className="text-zinc-400">User / Player</TableHead>
                          <TableHead className="text-zinc-400">Venue</TableHead>
                          <TableHead className="text-zinc-400">Date & Time</TableHead>
                          <TableHead className="text-zinc-400">Team Size</TableHead>
                          <TableHead className="text-right text-zinc-400">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bookings.map((booking: any) => (
                          <TableRow key={booking.id} className="border-zinc-800 hover:bg-zinc-800/50">
                            <TableCell className="font-medium text-white">{booking.booking_code}</TableCell>
                            <TableCell className="text-zinc-300">{booking.player_name}</TableCell>
                            <TableCell className="text-zinc-300">{booking.venues?.name || "Unknown"}</TableCell>
                            <TableCell className="text-zinc-300">
                              {booking.slots?.slot_date} {booking.slots?.start_time}
                            </TableCell>
                            <TableCell className="text-zinc-300">{booking.team_size}</TableCell>
                            <TableCell className="text-right text-[#00D084]">₹{booking.amount}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-center py-8 text-zinc-500">No bookings found.</div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="turfs" className="flex-1 min-h-0 mt-0">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-full min-h-0">
              <div className="md:col-span-1 h-full overflow-y-auto pr-2 pb-2">
                <Card className="bg-zinc-900/90 backdrop-blur-md border-zinc-800 shadow-xl">
                  <CardHeader>
                    <CardTitle className="text-white">{editingId ? "Update Turf" : "Add New Turf"}</CardTitle>
                    <CardDescription className="text-zinc-400">
                      {editingId ? "Update the details of the selected pitch." : "Create a new pitch for users to select."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleAddOrUpdateVenue} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="name" className="text-zinc-300">Name</Label>
                        <Input
                          id="name"
                          value={newVenue.name}
                          onChange={(e) => setNewVenue({ ...newVenue, name: e.target.value })}
                          className="bg-zinc-800 border-zinc-700 text-white"
                          placeholder="e.g. Central Park Turf"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="location" className="text-zinc-300">Location</Label>
                        <Input
                          id="location"
                          value={newVenue.location}
                          onChange={(e) => setNewVenue({ ...newVenue, location: e.target.value })}
                          className="bg-zinc-800 border-zinc-700 text-white"
                          placeholder="e.g. Bengaluru • Jayanagar"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="price" className="text-zinc-300">Price per Hour (₹)</Label>
                        <Input
                          id="price"
                          type="number"
                          min="0"
                          value={newVenue.price_per_hour}
                          onChange={(e) => setNewVenue({ ...newVenue, price_per_hour: e.target.value as any })}
                          className="bg-zinc-800 border-zinc-700 text-white"
                          placeholder="1500"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="desc" className="text-zinc-300">Description</Label>
                        <Input
                          id="desc"
                          value={newVenue.description}
                          onChange={(e) => setNewVenue({ ...newVenue, description: e.target.value })}
                          className="bg-zinc-800 border-zinc-700 text-white"
                          placeholder="A great place to play..."
                          required
                        />
                      </div>
                      <div className="flex gap-2 mt-4">
                        <Button type="submit" disabled={isLoading} className="flex-1 bg-[#00D084] hover:bg-[#00D084]/90 text-black font-semibold">
                          {isLoading ? "Saving..." : (editingId ? "Update Turf" : "Add Turf")}
                        </Button>
                        {editingId && (
                          <Button type="button" variant="outline" disabled={isLoading} onClick={handleCancelEdit} className="border-zinc-700 text-white hover:bg-zinc-800">
                            Cancel
                          </Button>
                        )}
                      </div>
                    </form>
                  </CardContent>
                </Card>
              </div>
              
              <div className="md:col-span-2 h-full min-h-0">
                <Card className="bg-zinc-900/90 backdrop-blur-md border-zinc-800 shadow-xl h-full flex flex-col">
                  <CardHeader className="shrink-0">
                    <CardTitle className="text-white">Existing Turfs</CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 min-h-0 overflow-hidden pb-6">
                    <div className="rounded-md border border-zinc-800 h-full overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-zinc-900">
                      <Table>
                        <TableHeader className="bg-zinc-950 sticky top-0 z-10 shadow-md">
                          <TableRow className="border-zinc-800 hover:bg-zinc-950/50">
                            <TableHead className="text-zinc-400">Name</TableHead>
                            <TableHead className="text-zinc-400">Location</TableHead>
                            <TableHead className="text-right text-zinc-400">Price / hr</TableHead>
                            <TableHead className="text-right text-zinc-400">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {venues.map((venue: any) => (
                            <TableRow key={venue.id} className="border-zinc-800 hover:bg-zinc-800/50">
                              <TableCell className="font-medium text-white">{venue.name}</TableCell>
                              <TableCell className="text-zinc-300">{venue.location}</TableCell>
                              <TableCell className="text-right text-[#00D084]">₹{venue.price_per_hour}</TableCell>
                              <TableCell className="text-right space-x-2">
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  onClick={() => handleEditClick(venue)}
                                  className="border-zinc-700 text-white hover:bg-zinc-800"
                                >
                                  Edit
                                </Button>
                                <Button 
                                  variant="destructive" 
                                  size="sm" 
                                  onClick={() => handleRemoveVenue(venue.id)}
                                  className="bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white"
                                >
                                  Remove
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="slots" className="flex-1 min-h-0 mt-0">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-full min-h-0">
              <div className="md:col-span-1 h-full overflow-y-auto pr-2 pb-2">
                <Card className="bg-zinc-900/90 backdrop-blur-md border-zinc-800 shadow-xl">
                  <CardHeader>
                    <CardTitle className="text-white">Add New Slot</CardTitle>
                    <CardDescription className="text-zinc-400">
                      Create available slots for users to book.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleAddSlot} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="venue_id" className="text-zinc-300">Venue</Label>
                        <select
                          id="venue_id"
                          value={newSlot.venue_id}
                          onChange={(e) => setNewSlot({ ...newSlot, venue_id: e.target.value })}
                          className="flex h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-sm text-white shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-300 disabled:cursor-not-allowed disabled:opacity-50"
                          required
                        >
                          <option value="" disabled>Select Turf</option>
                          {venues.map((v: any) => (
                            <option key={v.id} value={v.id}>{v.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="slot_date" className="text-zinc-300">Date</Label>
                        <Input
                          id="slot_date"
                          type="date"
                          value={newSlot.slot_date}
                          onChange={(e) => setNewSlot({ ...newSlot, slot_date: e.target.value })}
                          className="bg-zinc-800 border-zinc-700 text-white"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="start_time" className="text-zinc-300">Start Time</Label>
                        <Input
                          id="start_time"
                          type="time"
                          value={newSlot.start_time}
                          onChange={(e) => setNewSlot({ ...newSlot, start_time: e.target.value })}
                          className="bg-zinc-800 border-zinc-700 text-white"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="duration" className="text-zinc-300">Duration (mins)</Label>
                        <select
                          id="duration"
                          value={newSlot.duration_minutes}
                          onChange={(e) => setNewSlot({ ...newSlot, duration_minutes: Number(e.target.value) })}
                          className="flex h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-sm text-white shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-300 disabled:cursor-not-allowed disabled:opacity-50"
                          required
                        >
                          <option value={60}>60</option>
                          <option value={90}>90</option>
                          <option value={120}>120</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="court_label" className="text-zinc-300">Court Label</Label>
                        <Input
                          id="court_label"
                          value={newSlot.court_label}
                          onChange={(e) => setNewSlot({ ...newSlot, court_label: e.target.value })}
                          className="bg-zinc-800 border-zinc-700 text-white"
                          placeholder="e.g. Pitch A1"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="capacity" className="text-zinc-300">Capacity</Label>
                        <Input
                          id="capacity"
                          type="number"
                          min="1"
                          value={newSlot.capacity}
                          onChange={(e) => setNewSlot({ ...newSlot, capacity: Number(e.target.value) })}
                          className="bg-zinc-800 border-zinc-700 text-white"
                          required
                        />
                      </div>
                      <div className="flex gap-2 mt-4">
                        <Button type="submit" disabled={isSlotLoading} className="flex-1 bg-[#00D084] hover:bg-[#00D084]/90 text-black font-semibold">
                          {isSlotLoading ? "Saving..." : "Add Slot"}
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>
              </div>
              
              <div className="md:col-span-2 h-full min-h-0">
                <Card className="bg-zinc-900/90 backdrop-blur-md border-zinc-800 shadow-xl h-full flex flex-col">
                  <CardHeader className="shrink-0">
                    <CardTitle className="text-white">Existing Slots</CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 min-h-0 overflow-hidden pb-6">
                    <div className="rounded-md border border-zinc-800 h-full overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-zinc-900">
                      <Table>
                        <TableHeader className="bg-zinc-950 sticky top-0 z-10 shadow-md">
                          <TableRow className="border-zinc-800 hover:bg-zinc-950/50">
                            <TableHead className="text-zinc-400">Turf</TableHead>
                            <TableHead className="text-zinc-400">Date</TableHead>
                            <TableHead className="text-zinc-400">Time</TableHead>
                            <TableHead className="text-zinc-400">Court</TableHead>
                            <TableHead className="text-right text-zinc-400">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {slots && slots.map((slot: any) => (
                            <TableRow key={slot.id} className="border-zinc-800 hover:bg-zinc-800/50">
                              <TableCell className="font-medium text-white">{slot.venues?.name}</TableCell>
                              <TableCell className="text-zinc-300">{slot.slot_date}</TableCell>
                              <TableCell className="text-zinc-300">{slot.start_time} ({slot.duration_minutes}m)</TableCell>
                              <TableCell className="text-zinc-300">{slot.court_label}</TableCell>
                              <TableCell className="text-right space-x-2">
                                <Button 
                                  variant="destructive" 
                                  size="sm" 
                                  onClick={() => handleRemoveSlot(slot.id)}
                                  className="bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white"
                                >
                                  Remove
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
